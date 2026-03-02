"""
eligibility.py — Legal Aid Eligibility Assessor Sub-Agent
Powered by Amazon Nova 2 Lite via Strands Agents
Determines what kind of legal help the user qualifies for.
"""

from strands import Agent, tool
from strands.models import BedrockModel

MODEL_ID = "apac.amazon.nova-lite-v1:0"
REGION   = "ap-south-1"

ELIGIBILITY_PROMPT = """
You are a legal aid eligibility specialist. Assess whether a person
qualifies for free or low-cost legal help based on their situation.

Always respond in this exact JSON format — nothing else:
{
  "qualifies_for_legal_aid": true or false,
  "qualifies_for_pro_bono": true or false,
  "can_self_represent": true or false,
  "recommended_resources": [
    {"name": "<org name>", "type": "<LEGAL_AID|PRO_BONO|COURT_HELP|ONLINE>", "url": "<url if known>"}
  ],
  "income_threshold_note": "<brief note about income limits if relevant>",
  "next_steps": ["<step 1>", "<step 2>", "<step 3>"],
  "time_sensitive_actions": "<any actions needed within 7 days, or NONE>"
}

Legal aid typically serves households earning under 200% of federal poverty level.
Pro bono is available from bar association referrals regardless of income.
Self-representation (pro se) is possible for small claims and some family matters.
"""


@tool
def assess_eligibility(
    issue_category: str,
    urgency: str,
    state: str = "UNKNOWN",
    household_size: int = 1,
    monthly_income: float = 0.0,
) -> str:
    """
    Assesses legal aid eligibility and recommends resources for the user.

    Args:
        issue_category: Legal issue category (e.g. HOUSING, EMPLOYMENT).
        urgency: Issue urgency level (CRITICAL, HIGH, MEDIUM, LOW).
        state: US state abbreviation (e.g. CA, NY) or UNKNOWN.
        household_size: Number of people in household.
        monthly_income: Estimated monthly household income in USD.

    Returns:
        JSON string with eligibility determination and recommended next steps.
    """
    model  = BedrockModel(model_id=MODEL_ID, region_name=REGION, temperature=0.1)
    agent  = Agent(model=model, system_prompt=ELIGIBILITY_PROMPT)
    prompt = (
        f"Issue Category: {issue_category}\n"
        f"Urgency: {urgency}\n"
        f"State: {state}\n"
        f"Household Size: {household_size}\n"
        f"Monthly Income: ${monthly_income:.2f}\n\n"
        f"Please assess eligibility and recommend resources."
    )
    result = agent(prompt)
    return str(result)


# ── Standalone test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Testing Eligibility Assessor...\n")
    result = assess_eligibility(
        issue_category="HOUSING",
        urgency="CRITICAL",
        state="CA",
        household_size=3,
        monthly_income=2500.0,
    )
    print(result)