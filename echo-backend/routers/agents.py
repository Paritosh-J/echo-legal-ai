"""
agents.py — FastAPI router for the Strands Agent pipeline
Receives transcripts from Nova 2 Sonic and returns legal guidance.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from agents.orchestrator import EchoOrchestrator

router = APIRouter(prefix="/agents", tags=["agents"])

# One orchestrator instance per session (in production: per user session ID)
_orchestrators: dict[str, EchoOrchestrator] = {}


def get_orchestrator(session_id: str) -> EchoOrchestrator:
    if session_id not in _orchestrators:
        _orchestrators[session_id] = EchoOrchestrator()
    return _orchestrators[session_id]


# ── Request/Response models ────────────────────────────────────────────────────
class ProcessRequest(BaseModel):
    session_id: str
    message:    str

class ProcessResponse(BaseModel):
    response_text:  str
    classification: dict  = {}
    eligibility:    dict  = {}
    document:       str   = ""
    tool_calls:     list  = []


# ── Endpoints ──────────────────────────────────────────────────────────────────
@router.post("/process", response_model=ProcessResponse)
async def process_message(req: ProcessRequest):
    """
    Process a legal query through the full Strands Agent pipeline.
    Called by the WebSocket handler when a Nova 2 Sonic transcript arrives.
    """
    try:
        orch   = get_orchestrator(req.session_id)
        result = orch.process(req.message)
        return ProcessResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/reset/{session_id}")
async def reset_session(session_id: str):
    """Clear agent memory for a session — call when user starts a new case."""
    if session_id in _orchestrators:
        _orchestrators[session_id].reset()
    return {"status": "reset", "session_id": session_id}


@router.get("/health")
async def agents_health():
    return {"status": "ok", "active_sessions": len(_orchestrators)}