import boto3
import json

bedrock = boto3.client('bedrock-runtime', region_name='us-east-1')

# ─────────────────────────────────────────────
# TEST 1: Nova 2 Lite via Inference Profile
# ─────────────────────────────────────────────
print("\n" + "="*50)
print("TEST 1 — Amazon Nova 2 Lite")
print("="*50)

try:
    response = bedrock.invoke_model(
        modelId='us.amazon.nova-2-lite-v1:0',   # <-- us. prefix = inference profile
        body=json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": "You are Echo, a legal aid assistant. In one sentence, introduce yourself."}]
                }
            ]
        }),
        contentType='application/json',
        accept='application/json'
    )
    result = json.loads(response['body'].read())
    print("✅ PASS —", result['output']['message']['content'][0]['text'])
except Exception as e:
    print("❌ FAIL —", str(e))


# ─────────────────────────────────────────────
# TEST 2: Nova Multimodal Embeddings
# ─────────────────────────────────────────────
print("\n" + "="*50)
print("TEST 2 — Amazon Nova Multimodal Embeddings")
print("="*50)

try:
    response = bedrock.invoke_model(
        modelId='amazon.nova-2-multimodal-embeddings-v1:0',
        body=json.dumps({
            "taskType": "SINGLE_EMBEDDING",
            "singleEmbeddingParams": {
                "embeddingPurpose": "GENERIC_INDEX",
                "embeddingDimension": 256,
                "text": {
                    "truncationMode": "END",
                    "value": "Tenant rights violation, eviction without proper notice"
                }
            }
        }),
        contentType='application/json',
        accept='application/json'
    )
    result = json.loads(response['body'].read())
    embedding = result.get('embeddings', [{}])[0].get('embedding', [])
    embed_type = result.get('embeddings', [{}])[0].get('embeddingType', 'unknown')
    print(f"✅ PASS — Embedding generated: {len(embedding)} dimensions")
    print(f"   Embedding type: {embed_type}")
    print(f"   First 5 values: {embedding[:5]}")
except Exception as e:
    print("❌ FAIL —", str(e))


# ─────────────────────────────────────────────
# TEST 3: Nova 2 Sonic (Availability Check)
# ─────────────────────────────────────────────
print("\n" + "="*50)
print("TEST 3 — Amazon Nova 2 Sonic")
print("="*50)

try:
    bedrock_client = boto3.client('bedrock', region_name='us-east-1')
    model_info = bedrock_client.get_foundation_model(
        modelIdentifier='amazon.nova-2-sonic-v1:0'
    )
    status = model_info['modelDetails']['modelLifecycle']['status']
    print(f"✅ PASS — Status: {status}")
    print(f"   Model ARN: {model_info['modelDetails']['modelArn']}")
except Exception as e:
    print("❌ FAIL —", str(e))


# ─────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────
print("\n" + "="*50)
print("🎉  Smoke Test Complete!")
print("="*50 + "\n")