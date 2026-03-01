"""
main.py — Echo Legal AI Backend
FastAPI app with WebSocket endpoint for Nova 2 Sonic voice streaming
"""

import asyncio
import base64
import json
import os
import uuid
import boto3

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# ── Nova 2 Sonic SDK imports ───────────────────────────────────────────────────
from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient
from aws_sdk_bedrock_runtime.config import (
    Config, HTTPAuthSchemeResolver, SigV4AuthScheme
)
from aws_sdk_bedrock_runtime.models import (
    BidirectionalInputPayloadPart,
    InvokeModelWithBidirectionalStreamOperationInput,
    InvokeModelWithBidirectionalStreamInputChunk,
)
from smithy_aws_core.identity import AWSCredentialsIdentity
from smithy_core.aio.interfaces.identity import IdentityResolver
from routers.agents import router as agents_router
from routers.documents import router as documents_router


# ── Credentials bridge ────────────────────────────────────────────────────────
class Boto3CredentialsResolver(IdentityResolver):
    async def get_identity(self, *, properties=None):
        creds = boto3.Session().get_credentials().get_frozen_credentials()
        return AWSCredentialsIdentity(
            access_key_id     = creds.access_key,
            secret_access_key = creds.secret_key,
            session_token     = creds.token,
        )


# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(title="Echo Legal AI API", version="1.0.0")

app.include_router(agents_router)
app.include_router(documents_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

REGION   = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
MODEL_ID = "amazon.nova-2-sonic-v1:0"

ECHO_SYSTEM_PROMPT = (
    "You are Echo, a warm and knowledgeable AI legal aid assistant. "
    "Your mission is to help people — especially those who cannot afford attorneys — "
    "understand their legal rights and navigate the justice system. "
    "Use clear, simple language. Be empathetic. "
    "Keep responses concise — 2 to 4 sentences maximum. This is a voice conversation. "
    "Always remind users to consult a licensed attorney for final legal decisions. "
    "Respond in whatever language the user speaks. "
    "Start by warmly greeting the user and asking how you can help them today."
)


# ── Bedrock client factory ────────────────────────────────────────────────────
def make_bedrock_client() -> BedrockRuntimeClient:
    return BedrockRuntimeClient(
        config=Config(
            endpoint_uri=f"https://bedrock-runtime.{REGION}.amazonaws.com",
            region=REGION,
            aws_credentials_identity_resolver=Boto3CredentialsResolver(),
            auth_scheme_resolver=HTTPAuthSchemeResolver(),
            auth_schemes={"aws.auth#sigv4": SigV4AuthScheme(service="bedrock")}
        )
    )


# ── Nova Sonic session manager ────────────────────────────────────────────────
class SonicSession:
    """
    Manages one Nova 2 Sonic bidirectional stream session per WebSocket client.
    Bridges:  Browser mic audio → Nova Sonic → Browser speaker audio
    """

    def __init__(self, websocket: WebSocket):
        self.ws           = websocket
        self.prompt_name  = str(uuid.uuid4())
        self.sys_content  = str(uuid.uuid4())
        self.audio_in     = str(uuid.uuid4())
        self.is_active    = False
        self.stream       = None
        self.client       = None

    async def start(self):
        self.client = make_bedrock_client()
        self.stream = await self.client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=MODEL_ID)
        )
        self.is_active = True

        # Session start
        await self._send({"event": {"sessionStart": {
            "inferenceConfiguration": {
                "maxTokens": 1024, "topP": 0.9, "temperature": 0.7
            }
        }}})

        # Prompt start
        await self._send({"event": {"promptStart": {
            "promptName": self.prompt_name,
            "textOutputConfiguration":  {"mediaType": "text/plain"},
            "audioOutputConfiguration": {
                "mediaType":       "audio/lpcm",
                "sampleRateHertz": 24000,
                "sampleSizeBits":  16,
                "channelCount":    1,
                "voiceId":         "matthew",
                "encoding":        "base64",
                "audioType":       "SPEECH"
            }
        }}})

        # System prompt
        await self._send({"event": {"contentStart": {
            "promptName":  self.prompt_name,
            "contentName": self.sys_content,
            "type":        "TEXT",
            "interactive": False,
            "role":        "SYSTEM",
            "textInputConfiguration": {"mediaType": "text/plain"}
        }}})
        await self._send({"event": {"textInput": {
            "promptName":  self.prompt_name,
            "contentName": self.sys_content,
            "content":     ECHO_SYSTEM_PROMPT
        }}})
        await self._send({"event": {"contentEnd": {
            "promptName":  self.prompt_name,
            "contentName": self.sys_content
        }}})

        # Open audio input channel
        await self._send({"event": {"contentStart": {
            "promptName":  self.prompt_name,
            "contentName": self.audio_in,
            "type":        "AUDIO",
            "interactive": True,
            "role":        "USER",
            "audioInputConfiguration": {
                "mediaType":       "audio/lpcm",
                "sampleRateHertz": 16000,
                "sampleSizeBits":  16,
                "channelCount":    1,
                "audioType":       "SPEECH",
                "encoding":        "base64"
            }
        }}})

    async def stop(self):
        if not self.is_active:
            return
        self.is_active = False
        try:
            await self._send({"event": {"contentEnd": {
                "promptName": self.prompt_name, "contentName": self.audio_in
            }}})
            await self._send({"event": {"promptEnd":  {"promptName": self.prompt_name}}})
            await self._send({"event": {"sessionEnd": {}}})
            await self.stream.input_stream.close()
        except Exception as e:
            print(f"[stop_err] {e}")

    async def send_audio(self, pcm_b64: str):
        """Send base64-encoded PCM audio chunk from browser to Nova Sonic."""
        await self._send({"event": {"audioInput": {
            "promptName":  self.prompt_name,
            "contentName": self.audio_in,
            "content":     pcm_b64
        }}})

    async def receive_and_forward(self):
        """
        Receive events from Nova Sonic and forward them to the browser WebSocket.
        Sends two message types to frontend:
          { type: 'audio', data: '<base64 PCM>' }   → play through speakers
          { type: 'transcript', role: '...', text: '...' }  → show in UI
        """
        try:
            while self.is_active:
                try:
                    output = await self.stream.await_output()
                    result = await output[1].receive()

                    if not (result.value and result.value.bytes_):
                        continue

                    decoded    = json.loads(result.value.bytes_.decode("utf-8"))
                    event_data = decoded.get("event", {})

                    # ── Audio output → forward to browser ──────────────────
                    if "audioOutput" in event_data:
                        b64 = event_data["audioOutput"].get("content", "")
                        if b64:
                            await self.ws.send_text(json.dumps({
                                "type": "audio",
                                "data": b64
                            }))

                    # ── Transcript → forward to browser ────────────────────
                    if "textOutput" in event_data:
                        text = event_data["textOutput"].get("content", "").strip()
                        role = event_data["textOutput"].get("role", "")
                        if text:
                            await self.ws.send_text(json.dumps({
                                "type": "transcript",
                                "role": role,
                                "text": text
                            }))

                    # ── Session complete marker ─────────────────────────────
                    if "completionEnd" in event_data:
                        await self.ws.send_text(json.dumps({"type": "done"}))

                except Exception as inner:
                    err = str(inner)
                    if "timed out" in err.lower():
                        continue
                    if self.is_active:
                        print(f"[receive_err] {type(inner).__name__}: {inner}")
                        await self.ws.send_text(json.dumps({
                            "type": "error",
                            "message": str(inner)
                        }))
                    break

        except Exception as e:
            print(f"[stream_err] {type(e).__name__}: {e}")
        finally:
            self.is_active = False

    async def _send(self, payload: dict):
        raw   = json.dumps(payload).encode("utf-8")
        chunk = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=raw)
        )
        await self.stream.input_stream.send(chunk)


# ── WebSocket endpoint ────────────────────────────────────────────────────────
@app.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket):
    """
    Main WebSocket endpoint.
    Browser connects here, sends mic audio, receives Echo's voice + transcript.

    Message protocol (browser → server):
      { type: 'start' }                     → open Nova Sonic session
      { type: 'audio', data: '<b64 PCM>' }  → stream mic audio chunk
      { type: 'stop' }                      → close session

    Message protocol (server → browser):
      { type: 'ready' }                           → session open, Echo ready
      { type: 'audio', data: '<b64 PCM>' }        → Echo's voice audio
      { type: 'transcript', role, text }          → transcript line
      { type: 'error', message }                  → error notification
      { type: 'done' }                            → Echo finished speaking
    """
    await websocket.accept()
    session = SonicSession(websocket)
    receive_task = None

    print(f"[ws] Client connected")

    try:
        while True:
            raw_msg = await websocket.receive_text()
            msg     = json.loads(raw_msg)
            mtype   = msg.get("type")

            # ── Start session ─────────────────────────────────────────────
            if mtype == "start":
                print("[ws] Starting Nova Sonic session...")
                await session.start()
                receive_task = asyncio.create_task(session.receive_and_forward())
                await websocket.send_text(json.dumps({"type": "ready"}))
                print("[ws] Session ready — Echo is live!")

            # ── Audio chunk from browser mic ──────────────────────────────
            elif mtype == "audio":
                if session.is_active:
                    await session.send_audio(msg.get("data", ""))

            # ── Stop session ──────────────────────────────────────────────
            elif mtype == "stop":
                print("[ws] Stopping session...")
                await session.stop()
                if receive_task and not receive_task.done():
                    receive_task.cancel()
                await websocket.send_text(json.dumps({"type": "done"}))

    except WebSocketDisconnect:
        print("[ws] Client disconnected")
    except Exception as e:
        print(f"[ws_err] {type(e).__name__}: {e}")
    finally:
        await session.stop()
        if receive_task and not receive_task.done():
            receive_task.cancel()
        print("[ws] Cleanup complete")


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "service": "Echo Legal AI", "model": MODEL_ID}


# ── Run ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)