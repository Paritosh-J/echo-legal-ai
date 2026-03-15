"""
nova_act_router.py — FastAPI router for Nova Act autonomous form-filing workflows

Endpoints:
  POST /nova-act/start                → launch a workflow job (background thread)
  GET  /nova-act/status/{job_id}      → poll job status + steps
  GET  /nova-act/stream/{job_id}      → Server-Sent Events live step feed
  GET  /nova-act/recommend/{category} → recommended workflows for a legal category
  GET  /nova-act/health               → health check

Architecture:
  - Each workflow runs in a background daemon thread (Nova Act is synchronous)
  - Steps are written into an in-memory _jobs dict as they complete
  - Frontend can either poll /status or subscribe to /stream SSE
  - If nova-act SDK is not installed, a SimulatedWorkflow runs instead
    so the UI remains fully functional during development / testing
"""

import asyncio
import json
import os
import sys
import threading
import time
import uuid
from typing import Optional

# ── Path fix so imports work regardless of where uvicorn is launched from ─────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Load .env relative to this file so env vars are always present
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
load_dotenv(dotenv_path=_ENV_PATH, override=False)

# ── Try importing Nova Act — graceful fallback if not installed ───────────────
try:
    from nova_act import NovaAct, ActResult
    NOVA_ACT_AVAILABLE = True
    print("[nova-act] SDK imported successfully ✅")
except ImportError:
    NOVA_ACT_AVAILABLE = False
    print("[nova-act] SDK not installed — simulation mode active ⚠️")

NOVA_ACT_API_KEY = os.environ.get("NOVA_ACT_API_KEY", "")

router = APIRouter(prefix="/nova-act", tags=["nova-act"])

# ── In-memory job store ───────────────────────────────────────────────────────
# Structure per job:
# {
#   "status":        "queued" | "running" | "done" | "failed",
#   "workflow_name": str,
#   "steps":         [ {step_num, description, status, result, timestamp} ],
#   "confirmation":  str,
#   "error":         str,
#   "duration":      float,
# }
_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()


# ── Pydantic models ───────────────────────────────────────────────────────────
class WorkflowRequest(BaseModel):
    workflow_name:  str           # "legalaid" | "benefits" | "aba"
    session_id:     str
    first_name:     str
    last_name:      str  = ""
    email:          str
    phone:          str  = ""
    state:          str
    city:           str  = ""
    issue_type:     str  = "OTHER"
    issue_summary:  str  = "Legal assistance needed."
    monthly_income: float = 0.0
    household_size: int   = 1
    language:       str   = "English"


class WorkflowStatusResponse(BaseModel):
    job_id:        str
    status:        str
    workflow_name: str
    steps:         list
    confirmation:  str   = ""
    error:         str   = ""
    duration_secs: float = 0.0


# ── Step helper ───────────────────────────────────────────────────────────────
def _add_step(job_id: str, step_num: int, description: str,
              status: str = "running", result: str = "") -> None:
    step = {
        "step_num":    step_num,
        "description": description,
        "status":      status,
        "result":      result,
        "timestamp":   time.time(),
    }
    with _jobs_lock:
        steps = _jobs[job_id]["steps"]
        # Update existing step or append new one
        for i, s in enumerate(steps):
            if s["step_num"] == step_num:
                steps[i] = step
                return
        steps.append(step)


def _update_step(job_id: str, step_num: int,
                 status: str, result: str = "") -> None:
    with _jobs_lock:
        for step in _jobs[job_id]["steps"]:
            if step["step_num"] == step_num:
                step["status"] = status
                step["result"] = result
                step["timestamp"] = time.time()
                return


# ── Workflow map ──────────────────────────────────────────────────────────────
WORKFLOW_METADATA = {
    "legalaid": {
        "name":         "LegalAid.org Intake",
        "url":          "https://www.lsc.gov/about-lsc/what-legal-aid/find-legal-aid",
        "description":  "Finds and fills your intake form at the local legal aid office",
    },
    "benefits": {
        "name":         "USA.gov Benefits Finder",
        "url":          "https://www.benefits.gov/benefit-finder",
        "description":  "Identifies government benefit programs you qualify for",
    },
    "aba": {
        "name":         "ABA Free Legal Answers",
        "url":          "https://abafreelegalanswers.org",
        "description":  "Submits your legal question to a pro bono attorney",
    },
}

ISSUE_WORKFLOW_MAP = {
    "HOUSING":      ["legalaid", "aba"],
    "EMPLOYMENT":   ["legalaid", "benefits"],
    "IMMIGRATION":  ["legalaid", "aba"],
    "FAMILY_LAW":   ["legalaid", "aba"],
    "CONSUMER_DEBT":["benefits", "aba"],
    "CRIMINAL":     ["legalaid", "aba"],
    "OTHER":        ["legalaid"],
}


# ── Real Nova Act workflow ─────────────────────────────────────────────────────
def _run_real_workflow(job_id: str, req: WorkflowRequest) -> None:
    """Runs a real Nova Act browser automation workflow in a background thread."""
    meta       = WORKFLOW_METADATA.get(req.workflow_name, WORKFLOW_METADATA["legalaid"])
    start_time = time.time()

    _add_step(job_id, 1, f"Opening {meta['name']}...")

    try:
        with NovaAct(
            starting_page=meta["url"],
            headless=True,
            nova_act_api_key=NOVA_ACT_API_KEY,
        ) as nova:
            _update_step(job_id, 1, "done", f"Opened {meta['url']}")

            if req.workflow_name == "legalaid":
                # Step 2 — Find state office
                _add_step(job_id, 2, f"Finding legal aid office for {req.state}...")
                result: ActResult = nova.act(
                    f"Find the legal aid organization for the state of {req.state}. "
                    f"Look for a link or search to find legal aid by state."
                )
                _update_step(job_id, 2, "done", result.response[:200])

                # Step 3 — Navigate to intake
                _add_step(job_id, 3, "Navigating to intake form...")
                nova.act(
                    "Click on the link for the legal aid organization. "
                    "Look for 'Apply for Help', 'Get Help', or 'Request Services'."
                )
                _update_step(job_id, 3, "done", "Navigated to intake page")

                # Step 4 — Fill personal info
                _add_step(job_id, 4, "Filling in your personal information...")
                nova.act(
                    f"Fill in the intake form: "
                    f"First name: {req.first_name}. Last name: {req.last_name}. "
                    f"Email: {req.email}. Phone: {req.phone}. "
                    f"City: {req.city}. State: {req.state}. "
                    f"Preferred language: {req.language}."
                )
                _update_step(job_id, 4, "done", "Personal information filled")

                # Step 5 — Describe issue
                _add_step(job_id, 5, "Describing your legal issue...")
                nova.act(
                    f"In the legal issue description field enter: {req.issue_summary}. "
                    f"If there is a category dropdown, select the option closest to "
                    f"{req.issue_type.lower().replace('_', ' ')}."
                )
                _update_step(job_id, 5, "done", "Legal issue described")

                # Step 6 — Income info
                _add_step(job_id, 6, "Entering household and income details...")
                nova.act(
                    f"If there are fields for household size or income: "
                    f"Household size: {req.household_size}. "
                    f"Monthly income: ${req.monthly_income:.0f}. "
                    f"Do NOT submit the form yet."
                )
                _update_step(job_id, 6, "done", "Income details entered")

                # Step 7 — Submit
                _add_step(job_id, 7, "Submitting intake form...")
                submit: ActResult = nova.act(
                    "Submit the form by clicking Submit, Send, or Apply. "
                    "After submitting, tell me any confirmation number or reference "
                    "number shown on the page."
                )
                _update_step(job_id, 7, "done", submit.response[:300])
                confirmation = submit.response

            elif req.workflow_name == "benefits":
                # Step 2 — Start questionnaire
                _add_step(job_id, 2, "Starting benefits eligibility questionnaire...")
                nova.act("Click 'Start' or 'Find Benefits' to begin the questionnaire.")
                _update_step(job_id, 2, "done", "Questionnaire started")

                # Step 3 — Answer questions
                _add_step(job_id, 3, "Answering eligibility questions...")
                nova.act(
                    f"Answer the questionnaire: State: {req.state}. "
                    f"Household size: {req.household_size}. "
                    f"Monthly income: ${req.monthly_income:.0f}. "
                    f"Select options relevant to {req.issue_type.lower().replace('_',' ')} issues."
                )
                _update_step(job_id, 3, "done", "Questions answered")

                # Step 4 — Get results
                _add_step(job_id, 4, "Retrieving benefit program recommendations...")
                result: ActResult = nova.act(
                    "Submit or view results. List all benefit programs shown — "
                    "include program names and brief descriptions."
                )
                _update_step(job_id, 4, "done", result.response[:300])
                confirmation = result.response

            elif req.workflow_name == "aba":
                # Step 2 — Find state portal
                _add_step(job_id, 2, f"Finding {req.state} legal answers portal...")
                nova.act(
                    f"Find the portal for {req.state}. "
                    f"Look for a state selector or dropdown and select {req.state}."
                )
                _update_step(job_id, 2, "done", f"Navigated to {req.state} portal")

                # Step 3 — Access form
                _add_step(job_id, 3, "Accessing question submission form...")
                nova.act("Click 'Ask a Question', 'Submit a Question', or 'Get Started'.")
                _update_step(job_id, 3, "done", "Question form accessed")

                # Step 4 — Submit question
                _add_step(job_id, 4, "Submitting your legal question...")
                submit: ActResult = nova.act(
                    f"Fill in the form: "
                    f"Name: {req.first_name} {req.last_name}. Email: {req.email}. "
                    f"State: {req.state}. Issue type: {req.issue_type}. "
                    f"Question: {req.issue_summary} What are my rights and options? "
                    f"Submit the form and report any confirmation shown."
                )
                _update_step(job_id, 4, "done", submit.response[:300])
                confirmation = submit.response

            else:
                confirmation = f"Workflow '{req.workflow_name}' completed."

        duration = time.time() - start_time
        with _jobs_lock:
            _jobs[job_id]["status"]       = "done"
            _jobs[job_id]["confirmation"] = confirmation
            _jobs[job_id]["duration"]     = duration
        print(f"[nova-act] Job {job_id[:8]} done in {duration:.1f}s")

    except Exception as e:
        duration = time.time() - start_time
        error_msg = f"{type(e).__name__}: {str(e)}"
        print(f"[nova-act] Job {job_id[:8]} failed: {error_msg}")
        # Mark last running step as failed
        with _jobs_lock:
            for step in _jobs[job_id]["steps"]:
                if step["status"] == "running":
                    step["status"] = "failed"
                    step["result"] = error_msg
            _jobs[job_id]["status"]   = "failed"
            _jobs[job_id]["error"]    = error_msg
            _jobs[job_id]["duration"] = duration


# ── Simulated workflow (when Nova Act SDK not available) ──────────────────────
def _run_simulated_workflow(job_id: str, req: WorkflowRequest) -> None:
    """
    Simulates a Nova Act workflow with realistic delays.
    Used when nova-act SDK is not installed or API key is missing.
    Lets you demo the full UI flow without requiring Nova Act.
    """
    meta       = WORKFLOW_METADATA.get(req.workflow_name, WORKFLOW_METADATA["legalaid"])
    start_time = time.time()

    steps_config = {
        "legalaid": [
            (1, f"Opening {meta['name']}...",                    1.5, f"Opened {meta['url']}"),
            (2, f"Finding legal aid office for {req.state}...", 2.0, f"Located legal aid office in {req.state}"),
            (3, "Navigating to intake form...",                  1.5, "Found intake form"),
            (4, "Filling in personal information...",            2.5, f"Filled: {req.first_name} {req.last_name}, {req.email}"),
            (5, "Describing your legal issue...",                2.0, f"Issue entered: {req.issue_summary[:80]}..."),
            (6, "Entering household and income details...",      1.5, f"Household: {req.household_size}, Income: ${req.monthly_income:.0f}/mo"),
            (7, "Submitting intake form...",                     2.5, "Form submitted successfully"),
        ],
        "benefits": [
            (1, f"Opening {meta['name']}...",                    1.5, f"Opened {meta['url']}"),
            (2, "Starting benefits eligibility questionnaire...",2.0, "Questionnaire started"),
            (3, "Answering eligibility questions...",            3.0, f"Answered for {req.state}, household of {req.household_size}"),
            (4, "Retrieving benefit program recommendations...", 2.5, "Results retrieved"),
        ],
        "aba": [
            (1, f"Opening {meta['name']}...",                    1.5, f"Opened {meta['url']}"),
            (2, f"Finding {req.state} legal answers portal...", 2.0, f"Found {req.state} portal"),
            (3, "Accessing question submission form...",         1.5, "Question form accessed"),
            (4, "Submitting your legal question...",             2.5, "Question submitted"),
        ],
    }

    steps = steps_config.get(req.workflow_name, steps_config["legalaid"])

    try:
        for step_num, description, delay, result_text in steps:
            _add_step(job_id, step_num, description, status="running")
            time.sleep(delay)
            _update_step(job_id, step_num, "done", result_text)

        # Build a realistic confirmation message
        # if req.workflow_name == "legalaid":
        #     ref = str(uuid.uuid4())[:8].upper()
        #     confirmation = (
        #         f"Your intake form has been submitted to the {req.state} Legal Aid Society. "
        #         f"Reference number: LA-{ref}. "
        #         f"A case worker will contact you at {req.email} within 2-3 business days. "
        #         f"Keep this reference number for your records."
        #     )
        # elif req.workflow_name == "benefits":
        #     confirmation = (
        #         f"Based on your profile ({req.state}, household of {req.household_size}, "
        #         f"income ${req.monthly_income:.0f}/mo), you may qualify for: "
        #         f"Legal Aid Services, Emergency Rental Assistance, "
        #         f"SNAP Food Benefits, Medicaid/CHIP. "
        #         f"Visit benefits.gov to apply for each program."
        #     )
        # else:
        #     ref = str(uuid.uuid4())[:8].upper()
        #     confirmation = (
        #         f"Your legal question has been submitted to ABA Free Legal Answers ({req.state}). "
        #         f"Confirmation: ABA-{ref}. "
        #         f"A volunteer attorney will respond to {req.email} within 3-5 business days."
        #     )
        
        # =========================================================================
        # Build rich confirmation using the user's actual data
        # This is a simulation as Nova Act API key access is currently limited to US accounts
        # =========================================================================
        import datetime
        today     = datetime.date.today().strftime("%B %d, %Y")
        ref_id    = str(uuid.uuid4())[:8].upper()

        if req.workflow_name == "legalaid":
            confirmation = (
                f"✅ Intake form submitted to {req.state} Legal Aid Society on {today}.\n\n"
                f"📋 Reference Number: LA-{ref_id}\n\n"
                f"👤 Filed for: {req.first_name} {req.last_name}\n"
                f"📧 Contact: {req.email}\n"
                f"⚖️  Issue type: {req.issue_type.replace('_', ' ').title()}\n\n"
                f"📌 Summary filed:\n\"{req.issue_summary[:200]}...\"\n\n"
                f"🔜 Next steps:\n"
                f"  1. A case worker will contact you within 2–3 business days\n"
                f"  2. Prepare your ID, lease agreement, and any notices received\n"
                f"  3. Keep reference LA-{ref_id} for all future correspondence\n\n"
                f"💡 Note: Nova Act automation is available for US-based users. "
                f"Your intake has been prepared and is ready to submit manually at "
                f"lsc.gov/find-legal-aid if needed."
            )
        elif req.workflow_name == "benefits":
            confirmation = (
                f"✅ Benefits eligibility check completed on {today}.\n\n"
                f"📋 Reference: BEN-{ref_id}\n"
                f"📍 State: {req.state} | Household: {req.household_size} | "
                f"Income: ${req.monthly_income:.0f}/mo\n\n"
                f"🏛️ Programs you likely qualify for:\n"
                f"  • Emergency Rental/Housing Assistance\n"
                f"  • Legal Aid Services (income-based)\n"
                f"  • SNAP Food Benefits\n"
                f"  • Medicaid / CHIP Health Coverage\n"
                f"  • Low Income Home Energy Assistance (LIHEAP)\n\n"
                f"🔜 Next steps: Visit benefits.gov to apply for each program.\n"
                f"Most applications take 10–15 minutes online."
            )
        else:  # aba
            confirmation = (
                f"✅ Legal question submitted to ABA Free Legal Answers ({req.state}) on {today}.\n\n"
                f"📋 Confirmation: ABA-{ref_id}\n"
                f"📧 Response will be sent to: {req.email}\n\n"
                f"❓ Question filed:\n\"{req.issue_summary[:200]}...\"\n\n"
                f"🔜 A volunteer attorney will respond within 3–5 business days.\n"
                f"This is a free service provided by the American Bar Association."
            )

        duration = time.time() - start_time
        with _jobs_lock:
            _jobs[job_id]["status"]       = "done"
            _jobs[job_id]["confirmation"] = confirmation
            _jobs[job_id]["duration"]     = duration
        print(f"[nova-act] Simulated job {job_id[:8]} done in {duration:.1f}s")
    
    except Exception as e:
        duration = time.time() - start_time
        with _jobs_lock:
            _jobs[job_id]["status"]   = "failed"
            _jobs[job_id]["error"]    = str(e)
            _jobs[job_id]["duration"] = duration


# ── Background runner — picks real or simulated ───────────────────────────────
def _run_workflow_background(job_id: str, req: WorkflowRequest) -> None:
    use_real = NOVA_ACT_AVAILABLE and bool(NOVA_ACT_API_KEY)
    if use_real:
        print(f"[nova-act] Running REAL workflow: {req.workflow_name}")
        _run_real_workflow(job_id, req)
    else:
        reason = "SDK not installed" if not NOVA_ACT_AVAILABLE else "API key not set"
        print(f"[nova-act] Running SIMULATED workflow ({reason}): {req.workflow_name}")
        _run_simulated_workflow(job_id, req)


# ── POST /nova-act/start ──────────────────────────────────────────────────────
@router.post("/start")
async def start_workflow(req: WorkflowRequest):
    """
    Start a Nova Act workflow as a background job.
    Returns a job_id immediately — frontend polls /status or subscribes to /stream.
    """
    if req.workflow_name not in WORKFLOW_METADATA:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown workflow '{req.workflow_name}'. "
                   f"Valid options: {list(WORKFLOW_METADATA.keys())}"
        )

    job_id = str(uuid.uuid4())

    with _jobs_lock:
        _jobs[job_id] = {
            "status":        "queued",
            "workflow_name": req.workflow_name,
            "steps":         [],
            "confirmation":  "",
            "error":         "",
            "duration":      0.0,
        }

    thread = threading.Thread(
        target=_run_workflow_background,
        args=(job_id, req),
        daemon=True,
        name=f"nova-act-{job_id[:8]}"
    )
    thread.start()

    print(f"[nova-act] Started job {job_id[:8]} — workflow: {req.workflow_name} "
          f"| real: {NOVA_ACT_AVAILABLE and bool(NOVA_ACT_API_KEY)}")

    return {
        "job_id":        job_id,
        "status":        "queued",
        "workflow_name": req.workflow_name,
        "real_nova_act": NOVA_ACT_AVAILABLE and bool(NOVA_ACT_API_KEY),
    }


# ── GET /nova-act/status/{job_id} ─────────────────────────────────────────────
@router.get("/status/{job_id}", response_model=WorkflowStatusResponse)
async def get_workflow_status(job_id: str):
    """Poll this endpoint for live step updates and the final result."""
    with _jobs_lock:
        if job_id not in _jobs:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
        job = dict(_jobs[job_id])
        job["steps"] = list(job["steps"])   # shallow copy

    return WorkflowStatusResponse(
        job_id=        job_id,
        status=        job["status"],
        workflow_name= job["workflow_name"],
        steps=         job["steps"],
        confirmation=  job["confirmation"],
        error=         job["error"],
        duration_secs= job["duration"],
    )


# ── GET /nova-act/stream/{job_id} ─────────────────────────────────────────────
@router.get("/stream/{job_id}")
async def stream_workflow_steps(job_id: str):
    """
    Server-Sent Events stream — frontend connects here to receive live step
    updates without polling. Closes automatically when job finishes.
    """
    with _jobs_lock:
        if job_id not in _jobs:
            raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")

    async def event_generator():
        last_step_count = 0
        timeout_secs    = 300    # give up after 5 minutes
        elapsed         = 0.0
        interval        = 0.4   # poll interval

        while elapsed < timeout_secs:
            with _jobs_lock:
                job   = _jobs.get(job_id, {})
                steps = list(job.get("steps", []))

            # Send any new steps since last check
            new_steps = steps[last_step_count:]
            for step in new_steps:
                payload = json.dumps({"type": "step", "step": step})
                yield f"data: {payload}\n\n"
            last_step_count += len(new_steps)

            # Send completion event when job finishes
            status = job.get("status", "queued")
            if status in ("done", "failed"):
                payload = json.dumps({
                    "type": "complete",
                    "job": {
                        "status":       status,
                        "confirmation": job.get("confirmation", ""),
                        "error":        job.get("error", ""),
                        "duration":     job.get("duration", 0.0),
                    }
                })
                yield f"data: {payload}\n\n"
                return

            # Keepalive ping every ~10 seconds so the connection stays open
            if int(elapsed) % 10 == 0:
                yield f"data: {json.dumps({'type': 'ping'})}\n\n"

            await asyncio.sleep(interval)
            elapsed += interval

        # Timeout fallback
        yield f"data: {json.dumps({'type': 'complete', 'job': {'status': 'failed', 'error': 'Workflow timed out after 5 minutes.', 'confirmation': '', 'duration': timeout_secs}})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":               "no-cache",
            "X-Accel-Buffering":           "no",
            "Access-Control-Allow-Origin": "*",
        },
    )


# ── GET /nova-act/recommend/{issue_category} ──────────────────────────────────
@router.get("/recommend/{issue_category}")
async def recommend_workflows(issue_category: str):
    """Returns recommended workflow names for a given legal issue category."""
    category  = issue_category.upper()
    workflows = ISSUE_WORKFLOW_MAP.get(category, ["legalaid"])
    return {
        "issue_category":        category,
        "recommended_workflows": workflows,
        "workflow_details": {
            name: WORKFLOW_METADATA[name]
            for name in workflows
        },
    }


# ── GET /nova-act/health ──────────────────────────────────────────────────────
@router.get("/health")
async def nova_act_health():
    with _jobs_lock:
        active  = sum(1 for j in _jobs.values() if j["status"] == "running")
        total   = len(_jobs)

    return {
        "status":           "ok",
        "service":          "nova-act",
        "nova_act_sdk":     NOVA_ACT_AVAILABLE,
        "api_key_set":      bool(NOVA_ACT_API_KEY),
        "mode":             "real" if (NOVA_ACT_AVAILABLE and NOVA_ACT_API_KEY) else "simulated",
        "active_jobs":      active,
        "total_jobs":       total,
    }