import boto3, os
from dotenv import load_dotenv
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

load_dotenv()

ENDPOINT     = os.environ.get("OPENSEARCH_ENDPOINT", "").replace("https://", "")
EMBED_REGION = os.environ.get("EMBEDDINGS_REGION", "ap-south-1")

print(f"Endpoint     : {ENDPOINT}")
print(f"Sign region  : {EMBED_REGION}")

# Check what ARN boto3 resolves to right now
sts   = boto3.client("sts")
me    = sts.get_caller_identity()
print(f"Current ARN  : {me['Arn']}")
print()

# Try connecting and listing indexes
credentials = boto3.Session().get_credentials()
auth = AWSV4SignerAuth(credentials, EMBED_REGION, "aoss")

client = OpenSearch(
    hosts=[{"host": ENDPOINT, "port": 443}],
    http_auth=auth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
    timeout=30,
)

try:
    info = client.info()
    print("✅ Connected to OpenSearch:", info["version"])
    indices = client.indices.get_alias("*")
    print("   Indices:", list(indices.keys()))
except Exception as e:
    print(f"❌ Connection failed: {type(e).__name__}: {e}")
    print()
    print("→ This means either:")
    print("  1. The data access policy doesn't include your current IAM ARN")
    print("  2. The signing region doesn't match the collection's actual region")
    print("  3. OPENSEARCH_ENDPOINT is missing from .env")