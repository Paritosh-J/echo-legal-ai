"""
setup_opensearch.py
Creates the required security policies and vector index for Echo Legal AI.
Run ONCE after creating the OpenSearch Serverless collection in AWS Console.
"""

import boto3
import json
import time
import os
from dotenv import load_dotenv
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

load_dotenv()

REGION   = "us-east-1"
COLLECTION = "echo-legal-docs"
INDEX_NAME = "legal-documents"

# ── Get your account ID and IAM user ARN ──────────────────────────────────────
sts    = boto3.client("sts", region_name=REGION)
caller = sts.get_caller_identity()
ACCOUNT_ID = caller["Account"]
USER_ARN   = caller["Arn"]
print(f"✅ Account ID : {ACCOUNT_ID}")
print(f"✅ User ARN   : {USER_ARN}")

# ── Create OpenSearch Serverless client ───────────────────────────────────────
aoss = boto3.client("opensearchserverless", region_name=REGION)


# ── Step 1: Encryption policy ─────────────────────────────────────────────────
print("\n[1/4] Creating encryption policy...")
try:
    aoss.create_security_policy(
        name="echo-encryption",
        type="encryption",
        policy=json.dumps({
            "Rules": [{"Resource": [f"collection/{COLLECTION}"], "ResourceType": "collection"}],
            "AWSOwnedKey": True
        })
    )
    print("     ✅ Encryption policy created")
except aoss.exceptions.ConflictException:
    print("     ⚠️  Already exists — skipping")


# ── Step 2: Network policy ────────────────────────────────────────────────────
print("[2/4] Creating network policy...")
try:
    aoss.create_security_policy(
        name="echo-network",
        type="network",
        policy=json.dumps([{
            "Rules": [
                {"Resource": [f"collection/{COLLECTION}"], "ResourceType": "collection"},
                {"Resource": [f"collection/{COLLECTION}"], "ResourceType": "dashboard"}
            ],
            "AllowFromPublic": True
        }])
    )
    print("     ✅ Network policy created")
except aoss.exceptions.ConflictException:
    print("     ⚠️  Already exists — skipping")


# ── Step 3: Data access policy ────────────────────────────────────────────────
print("[3/4] Creating data access policy...")
try:
    aoss.create_access_policy(
        name="echo-access",
        type="data",
        policy=json.dumps([{
            "Rules": [
                {
                    "Resource": [f"collection/{COLLECTION}"],
                    "Permission": [
                        "aoss:CreateCollectionItems",
                        "aoss:DeleteCollectionItems",
                        "aoss:UpdateCollectionItems",
                        "aoss:DescribeCollectionItems"
                    ],
                    "ResourceType": "collection"
                },
                {
                    "Resource": [f"index/{COLLECTION}/*"],
                    "Permission": [
                        "aoss:CreateIndex",
                        "aoss:DeleteIndex",
                        "aoss:UpdateIndex",
                        "aoss:DescribeIndex",
                        "aoss:ReadDocument",
                        "aoss:WriteDocument"
                    ],
                    "ResourceType": "index"
                }
            ],
            "Principal": [USER_ARN],
            "Description": "Echo Legal AI data access"
        }])
    )
    print("     ✅ Data access policy created")
except aoss.exceptions.ConflictException:
    print("     ⚠️  Already exists — skipping")


# ── Step 4: Create vector index ───────────────────────────────────────────────
print("[4/4] Creating vector index in OpenSearch...")

endpoint = os.environ.get("OPENSEARCH_ENDPOINT", "").replace("https://", "")
if not endpoint:
    print("❌ OPENSEARCH_ENDPOINT not set in .env — set it and rerun")
    exit(1)

# Wait for data access policy to propagate
print("     Waiting 30s for policies to propagate...")
time.sleep(30)

credentials = boto3.Session().get_credentials()
auth = AWSV4SignerAuth(credentials, REGION, "aoss")

os_client = OpenSearch(
    hosts=[{"host": endpoint, "port": 443}],
    http_auth=auth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    pool_maxsize=20,
    timeout=300,
)

# Create index with k-NN vector mapping
index_body = {
    "settings": {
        "index": {
            "knn": True,
            "knn.algo_param.ef_search": 100
        }
    },
    "mappings": {
        "properties": {
            # Vector field — 1024 dims matches Nova Multimodal Embeddings default
            "embedding": {
                "type": "knn_vector",
                "dimension": 1024,
                "method": {
                    "name":       "hnsw",
                    "engine":     "faiss",
                    "space_type": "cosinesimil",
                    "parameters": {"ef_construction": 128, "m": 24}
                }
            },
            # Metadata fields
            "user_id":    {"type": "keyword"},
            "session_id": {"type": "keyword"},
            "doc_id":     {"type": "keyword"},
            "filename":   {"type": "keyword"},
            "doc_type":   {"type": "keyword"},
            "chunk_text": {"type": "text"},
            "chunk_index":{"type": "integer"},
            "s3_key":     {"type": "keyword"},
            "uploaded_at":{"type": "date"},
            "embed_type": {"type": "keyword"},
        }
    }
}

if os_client.indices.exists(index=INDEX_NAME):
    print(f"     ⚠️  Index '{INDEX_NAME}' already exists — skipping")
else:
    os_client.indices.create(index=INDEX_NAME, body=index_body)

print("\n🎉 OpenSearch setup complete! Echo is ready to index documents.\n")