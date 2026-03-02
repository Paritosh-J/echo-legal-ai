import boto3

bedrock = boto3.client('bedrock', region_name='ap-south-1')
response = bedrock.list_inference_profiles(
    typeEquals='SYSTEM_DEFINED',
    maxResults=100
)

print('=== Nova profiles in ap-south-1 ===\n')
nova_profiles = []
for p in response['inferenceProfileSummaries']:
    pid    = p['inferenceProfileId']
    name   = p['inferenceProfileName']
    status = p['status']
    if 'nova' in pid.lower() or 'nova' in name.lower():
        print(f"NAME   : {name}")
        print(f"ID     : {pid}")
        print(f"STATUS : {status}")
        print()
        nova_profiles.append(pid)

if not nova_profiles:
    print('No Nova profiles found. Showing ALL profiles:\n')
    for p in response['inferenceProfileSummaries']:
        print(f"{p['inferenceProfileId']} — {p['status']}")