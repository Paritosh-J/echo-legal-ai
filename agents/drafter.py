"""
drafter.py — Legal Document Drafter Sub-Agent
Powered by Amazon Nova 2 Lite via Strands Agents
Generates customized legal letters and declarations.
"""

from strands import Agent, tool
from strands.models import BedrockModel

MODEL_ID = "apac.amazon.nova-lite-v1:0"
REGION   = "ap-south-1"

DRAFTER_PROMPT = """
You are an expert legal document drafter specializing in plain-language
legal letters for self-represented individuals.

When drafting documents:
- Use clear, professional language accessible to non-lawyers
- Include all legally relevant dates, parties, and facts provided
- Reference applicable laws when known (e.g. state landlord-tenant statutes)
- Use formal letter format with proper salutation and signature block
- Add a disclaimer at the bottom reminding the user to have an attorney review
- Never fabricate case numbers, statute citations, or legal facts not provided

Document types you can draft:
- DEMAND_LETTER: Formal demand for payment or action
- TENANT_RIGHTS_LETTER: Response to eviction or habitability issues
- WAGE_CLAIM_LETTER: Claim for unpaid wages
- CEASE_AND_DESIST: Stop harassment or illegal activity
- HARDSHIP_DECLARATION: Statement of financial hardship for court
- GENERAL_RESPONSE: Response to any legal notice
"""


@tool
def draft_legal_document(
    document_type: str,
    user_name: str,
    issue_summary: str,
    key_facts: list,
    recipient_name: str = "To Whom It May Concern",
    state: str = "UNKNOWN",
    additional_context: str = "",
) -> str:
    """
    Drafts a customized legal document based on the user's situation.

    Args:
        document_type: Type of document (DEMAND_LETTER, TENANT_RIGHTS_LETTER,
                       WAGE_CLAIM_LETTER, CEASE_AND_DESIST, HARDSHIP_DECLARATION,
                       GENERAL_RESPONSE).
        user_name: Full name of the person the letter is for.
        issue_summary: One-sentence summary of the legal issue.
        key_facts: List of key facts to include in the document.
        recipient_name: Name of the person or org receiving the letter.
        state: US state for jurisdiction-specific language.
        additional_context: Any extra details to incorporate.

    Returns:
        A complete, formatted legal document as a string.
    """
    model  = BedrockModel(model_id=MODEL_ID, region_name=REGION, temperature=0.1)
    agent  = Agent(model=model, system_prompt=DRAFTER_PROMPT)

    facts_text = "\n".join(f"- {f}" for f in key_facts)
    prompt = (
        f"Draft a {document_type} for the following situation:\n\n"
        f"Client Name: {user_name}\n"
        f"Recipient: {recipient_name}\n"
        f"State/Jurisdiction: {state}\n"
        f"Issue Summary: {issue_summary}\n\n"
        f"Key Facts:\n{facts_text}\n\n"
        f"Additional Context: {additional_context or 'None'}\n\n"
        f"Please draft the complete document now."
    )
    result = agent(prompt)
    return str(result)


# ── Standalone test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Testing Document Drafter...\n")
    result = draft_legal_document(
        document_type="TENANT_RIGHTS_LETTER",
        user_name="Maria Garcia",
        issue_summary="Landlord issued eviction notice without required 30-day period",
        key_facts=[
            "Rent was paid in full on March 1st",
            "Eviction notice dated March 10th demands vacating by March 13th",
            "California law requires 30 days notice for month-to-month tenants",
            "Tenant has lived at property for 3 years with no prior violations",
        ],
        recipient_name="Property Manager, Sunset Apartments",
        state="CA",
    )
    print(result)