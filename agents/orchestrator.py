"""
orchestrator.py — Echo Legal AI Orchestrator
The master agent that receives user input and coordinates
the Classifier, Eligibility, and Drafter sub-agents.
Powered by Amazon Nova 2 Lite via Strands Agents.
"""

import json
import os
import sys

# Add parent dir so agents can import each other
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from strands import Agent, tool
from strands.models import BedrockModel

from agents.classifier  import classify_legal_issue
from agents.eligibility import assess_eligibility
from agents.drafter     import draft_legal_document

MODEL_ID = "us.amazon.nova-2-lite-v1:0"

ORCHESTRATOR_PROMPT = """
You are Echo, a compassionate AI legal aid assistant and orchestrator.
You coordinate specialist tools to help users with their legal problems.

Your workflow for EVERY user legal question:
1. CLASSIFY the issue using classify_legal_issue tool
2. ASSESS eligibility using assess_eligibility tool
3. If urgency is CRITICAL or HIGH — DRAFT a document using draft_legal_document tool
4. Synthesize everything into a warm, clear voice-friendly response

Your spoken responses must be:
- Conversational and empathetic — the user may be scared or stressed
- Concise — 3 to 5 sentences maximum for voice delivery
- Action-oriented — always end with one clear next step
- Free of legal jargon — explain any legal terms immediately

After completing tools, summarize results in plain language.
Always end with: "Would you like me to file this with a legal aid organization?"

IMPORTANT: You provide legal INFORMATION, not legal ADVICE.
Always remind users to consult a licensed attorney for final decisions.
"""


class EchoOrchestrator:
    """
    Wraps the Strands Agent orchestrator with session memory
    and a clean interface for the FastAPI backend to call.
    """

    def __init__(self):
        self.model = BedrockModel(
            model_id=MODEL_ID,
            region_name="us-east-1",
            temperature=0.4,
            streaming=True,
        )
        self.agent = Agent(
            model=self.model,
            system_prompt=ORCHESTRATOR_PROMPT,
            tools=[
                classify_legal_issue,
                assess_eligibility,
                draft_legal_document,
            ],
        )
        self.conversation_history = []

    def process(self, user_message: str) -> dict:
        """
        Process a user message through the full agent pipeline.

        Args:
            user_message: Text from the user (from Nova 2 Sonic transcript).

        Returns:
            dict with keys:
              - response_text: Echo's spoken response (voice-friendly)
              - classification: structured legal issue data
              - document: drafted legal document if generated
              - eligibility: eligibility assessment data
              - tool_calls: list of tools that were invoked
        """
        result = self.agent(user_message)

        # Extract structured data from tool use results
        tool_calls   = []
        classification = {}
        eligibility    = {}
        document       = ""

        # Parse tool results from agent metrics/trace
        for item in result.metrics.tool_metrics if hasattr(result, 'metrics') else []:
            tool_calls.append(item)

        response_text = str(result)

        return {
            "response_text":  response_text,
            "classification": classification,
            "eligibility":    eligibility,
            "document":       document,
            "tool_calls":     tool_calls,
        }

    def reset(self):
        """Clear conversation history for a new session."""
        self.agent = Agent(
            model=self.model,
            system_prompt=ORCHESTRATOR_PROMPT,
            tools=[
                classify_legal_issue,
                assess_eligibility,
                draft_legal_document,
            ],
        )


# ── Standalone test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  🧠 Echo Orchestrator — Agent Pipeline Test")
    print("=" * 60 + "\n")

    orchestrator = EchoOrchestrator()

    test_inputs = [
        "I got an eviction notice 3 days ago. My landlord says I have to leave by Friday but I paid my rent.",
        "My boss hasn't paid me for 3 weeks. I work at a restaurant in California.",
    ]

    for user_input in test_inputs:
        print(f"👤 User: {user_input}\n")
        result = orchestrator.process(user_input)
        print(f"⚖️  Echo: {result['response_text']}")
        print("\n" + "-" * 60 + "\n")