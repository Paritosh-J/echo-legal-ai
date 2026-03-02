"""
classifier.py — Legal Issue Classifier Sub-Agent
Powered by Amazon Nova 2 Lite via Strands Agents
Identifies the category and severity of a user's legal issue.
"""

from strands import Agent, tool
from strands.models import BedrockModel

MODEL_ID = "apac.amazon.nova-lite-v1:0"
REGION   = "ap-south-1"

# ── System prompt ──────────────────────────────────────────────────────────────
CLASSIFIER_PROMPT = """
You are a legal issue classifier. Your ONLY job is to analyze a user's
situation and return a structured classification.

Always respond in this exact JSON format — nothing else:
{
  "category": "<one of: HOUSING, EMPLOYMENT, IMMIGRATION, FAMILY_LAW, CONSUMER_DEBT, CRIMINAL, OTHER>",
  "subcategory": "<specific issue e.g. WRONGFUL_EVICTION, WAGE_THEFT, VISA_OVERSTAY>",
  "urgency": "<one of: CRITICAL, HIGH, MEDIUM, LOW>",
  "jurisdiction_hint": "<state if mentioned, else UNKNOWN>",
  "summary": "<one sentence plain English summary of the issue>",
  "key_facts": ["<fact 1>", "<fact 2>", "<fact 3>"]
}

Urgency guide:
- CRITICAL: Active eviction in < 7 days, arrest, deportation order
- HIGH: Court date within 30 days, job termination, active wage theft
- MEDIUM: Ongoing dispute, pending legal action
- LOW: General inquiry, long-term planning
"""


@tool
def classify_legal_issue(description: str) -> str:
    """
    Classifies a user's legal issue into a structured category.

    Args:
        description: The user's description of their legal problem in plain language.

    Returns:
        JSON string with category, subcategory, urgency, jurisdiction_hint,
        summary, and key_facts.
    """
    model = BedrockModel(
        model_id=MODEL_ID,
        region_name=REGION,
        temperature=0.1,
    )

    agent  = Agent(model=model, system_prompt=CLASSIFIER_PROMPT)
    result = agent(description)
    return str(result)


# ── Standalone test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    test_cases = [
        "I got an eviction notice yesterday. My landlord says I have 3 days to leave but I paid rent last week.",
        "My employer hasn't paid me for the last two weeks. I work at a restaurant.",
        "I overstayed my visa by 6 months. What happens now?",
    ]
    for tc in test_cases:
        print(f"\n📋 Input: {tc[:60]}...")
        print(f"📊 Result: {classify_legal_issue(tc)}")
        print("-" * 60)