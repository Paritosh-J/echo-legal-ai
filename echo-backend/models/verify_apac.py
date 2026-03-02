import boto3, json
from dotenv import load_dotenv
load_dotenv('.env')

# ── Test 1: Nova Lite APAC ─────────────────────────────────────────────────
print("Test 1: Nova Lite (ap-south-1)...")
client = boto3.client('bedrock-runtime', region_name='ap-south-1')
response = client.invoke_model(
    modelId='apac.amazon.nova-lite-v1:0',
    body=json.dumps({
        'messages': [{'role': 'user', 'content': [
            {'text': 'Say hello as Echo, a legal AI assistant. One sentence.'}
        ]}]
    }),
    contentType='application/json',
    accept='application/json'
)
result = json.loads(response['body'].read())
print('✅ Nova Lite:', result['output']['message']['content'][0]['text'])
print()

# ── Test 2: Titan Embeddings in ap-south-1 ────────────────────────────────
print("Test 2: Titan Embeddings (ap-south-1)...")
emb_response = client.invoke_model(
    modelId='amazon.titan-embed-text-v2:0',
    body=json.dumps({'inputText': 'eviction notice tenant rights'}),
    contentType='application/json',
    accept='application/json'
)
emb_result = json.loads(emb_response['body'].read())
dims = len(emb_result['embedding'])
print(f'✅ Titan Embeddings: {dims} dimensions')
print()

# ── Test 3: Nova Sonic via us-east-1 endpoint ─────────────────────────────
print("Test 3: Nova Sonic model status (us-east-1)...")
try:
    us_client = boto3.client('bedrock', region_name='us-east-1')
    sonic = us_client.get_foundation_model(modelIdentifier='amazon.nova-2-sonic-v1:0')
    print(f"✅ Nova Sonic: {sonic['modelDetails']['modelLifecycle']['status']}")
except Exception as e:
    print(f"⚠️  Nova Sonic us-east-1: {e}")
print()

print("=" * 50)
print("All tests complete!")