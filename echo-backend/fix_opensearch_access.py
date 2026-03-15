"""
fix_opensearch_access.py
Re-applies the data access policy using your CURRENT IAM ARN.
Run this whenever you get a 403 from OpenSearch Serverless.
"""

import boto3, json, os
from dotenv import load_dotenv
load_dotenv()

# ── Detect collection region from endpoint ────────────────────────────────────
# Extract the region from it automatically
endpoint = os.environ.get("OPENSEARCH_ENDPOINT", "")
if not endpoint:
    print("❌ OPENSEARCH_ENDPOINT not set in .env")
    exit(1)

# Parse region from endpoint URL — works for any region
import re
match = re.search(r'\.([a-z0-9-]+)\.aoss\.amazonaws\.com', endpoint)
if not match:
    print(f"❌ Could not parse region from endpoint: {endpoint}")
    exit(1)

COLLECTION_REGION = match.group(1)
COLLECTION        = "echo-legal-docs"
print(f"Collection region (from endpoint): {COLLECTION_REGION}")

# ── Get current IAM identity ──────────────────────────────────────────────────
sts      = boto3.client("sts", region_name=COLLECTION_REGION)
caller   = sts.get_caller_identity()
USER_ARN = caller["Arn"]
print(f"Current IAM ARN: {USER_ARN}")

# ── Update data access policy ─────────────────────────────────────────────────
aoss = boto3.client("opensearchserverless", region_name=COLLECTION_REGION)

policy_doc = json.dumps([{
    "Rules": [
        {
            "Resource":     [f"collection/{COLLECTION}"],
            "Permission":   [
                "aoss:CreateCollectionItems",
                "aoss:DeleteCollectionItems",
                "aoss:UpdateCollectionItems",
                "aoss:DescribeCollectionItems"
            ],
            "ResourceType": "collection"
        },
        {
            "Resource":     [f"index/{COLLECTION}/*"],
            "Permission":   [
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
    "Principal":   [USER_ARN],
    "Description": "Echo Legal AI data access"
}])

# Try update first, create if not exists
try:
    existing = aoss.get_access_policy(name="echo-access", type="data")
    version  = existing["accessPolicyDetail"]["policyVersion"]
    aoss.update_access_policy(
        name="echo-access",
        type="data",
        policyVersion=version,
        policy=policy_doc,
    )
    print("✅ Data access policy UPDATED with current ARN")
except aoss.exceptions.ResourceNotFoundException:
    aoss.create_access_policy(
        name="echo-access",
        type="data",
        policy=policy_doc,
    )
    print("✅ Data access policy CREATED with current ARN")

print("\nWaiting 20s for policy to propagate...")
import time; time.sleep(20)
print("Done — try uploading the document again.")