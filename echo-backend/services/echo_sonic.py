"""
echo_sonic.py — Echo Legal AI Voice Engine
Powered by Amazon Nova 2 Sonic
Uses correct await_output()/receive() pattern from official AWS docs.
Audio via sounddevice (no PyAudio needed — Python 3.14 compatible).
"""

import asyncio
import base64
import json
import os
import queue
import threading
import uuid

import sounddevice as sd
import numpy as np

import boto3
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

from aws_sdk_bedrock_runtime.client import BedrockRuntimeClient
from aws_sdk_bedrock_runtime.config import (
    Config,
    HTTPAuthSchemeResolver,
    SigV4AuthScheme,
)
from aws_sdk_bedrock_runtime.models import (
    BidirectionalInputPayloadPart,
    InvokeModelWithBidirectionalStreamOperationInput,
    InvokeModelWithBidirectionalStreamInputChunk,
)
from smithy_aws_core.identity import AWSCredentialsIdentity
from smithy_core.aio.interfaces.identity import IdentityResolver


class Boto3CredentialsResolver(IdentityResolver):
    """
    Bridges boto3's credential chain into the Smithy SDK.
    This lets the Nova Sonic SDK use the same credentials that
    boto3/AWS CLI already have configured — no duplication needed.
    """
    async def get_identity(self, *, properties=None):
        session = boto3.Session()
        creds = session.get_credentials().get_frozen_credentials()
        return AWSCredentialsIdentity(
            access_key_id     = creds.access_key,
            secret_access_key = creds.secret_key,
            session_token     = creds.token,
        )


# ── Audio settings ─────────────────────────────────────────────────────────────
INPUT_SAMPLE_RATE  = 16000   # mic  → Nova Sonic
OUTPUT_SAMPLE_RATE = 24000   # Nova Sonic → speakers
CHANNELS           = 1
CHUNK_FRAMES       = 1024

# ── Echo system prompt ─────────────────────────────────────────────────────────
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


class EchoVoiceEngine:

    MODEL_ID = "amazon.nova-2-sonic-v1:0"
    REGION   = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")

    def __init__(self):
        self.prompt_name        = str(uuid.uuid4())
        self.system_content     = str(uuid.uuid4())
        self.audio_content      = str(uuid.uuid4())
        self.is_active          = False
        self.bedrock_client     = None
        self.stream_response    = None
        self._audio_out_queue   = queue.Queue()
        self._mic_queue         = queue.Queue()

    # ── Client ────────────────────────────────────────────────────────────────
    def _init_client(self):
        self.bedrock_client = BedrockRuntimeClient(
        config=Config(
            endpoint_uri=f"https://bedrock-runtime.{self.REGION}.amazonaws.com",
            region=self.REGION,
            aws_credentials_identity_resolver=Boto3CredentialsResolver(),
            auth_scheme_resolver=HTTPAuthSchemeResolver(),
            auth_schemes={"aws.auth#sigv4": SigV4AuthScheme(service="bedrock")}
        )
    )


    # ── Send one event ────────────────────────────────────────────────────────
    async def _send(self, payload: dict):
        raw = json.dumps(payload).encode("utf-8")
        chunk = InvokeModelWithBidirectionalStreamInputChunk(
            value=BidirectionalInputPayloadPart(bytes_=raw)
        )
        await self.stream_response.input_stream.send(chunk)

    # ── Session setup ─────────────────────────────────────────────────────────
    async def start_session(self):
        self._init_client()

        # Open bidirectional stream
        self.stream_response = await self.bedrock_client.invoke_model_with_bidirectional_stream(
            InvokeModelWithBidirectionalStreamOperationInput(model_id=self.MODEL_ID)
        )
        self.is_active = True

        # 1 — Session start
        await self._send({"event": {"sessionStart": {
            "inferenceConfiguration": {
                "maxTokens": 1024, "topP": 0.9, "temperature": 0.7
            }
        }}})

        # 2 — Prompt start
        await self._send({"event": {"promptStart": {
            "promptName": self.prompt_name,
            "textOutputConfiguration":  {"mediaType": "text/plain"},
            "audioOutputConfiguration": {
                "mediaType":       "audio/lpcm",
                "sampleRateHertz": OUTPUT_SAMPLE_RATE,
                "sampleSizeBits":  16,
                "channelCount":    1,
                "voiceId":         "matthew",
                "encoding":        "base64",
                "audioType":       "SPEECH"
            }
        }}})

        # 3 — System prompt
        await self._send({"event": {"contentStart": {
            "promptName":  self.prompt_name,
            "contentName": self.system_content,
            "type":        "TEXT",
            "interactive": False,
            "role":        "SYSTEM",
            "textInputConfiguration": {"mediaType": "text/plain"}
        }}})
        await self._send({"event": {"textInput": {
            "promptName":  self.prompt_name,
            "contentName": self.system_content,
            "content":     ECHO_SYSTEM_PROMPT
        }}})
        await self._send({"event": {"contentEnd": {
            "promptName":  self.prompt_name,
            "contentName": self.system_content
        }}})

        # 4 — Open audio input channel
        await self._send({"event": {"contentStart": {
            "promptName":  self.prompt_name,
            "contentName": self.audio_content,
            "type":        "AUDIO",
            "interactive": True,
            "role":        "USER",
            "audioInputConfiguration": {
                "mediaType":       "audio/lpcm",
                "sampleRateHertz": INPUT_SAMPLE_RATE,
                "sampleSizeBits":  16,
                "channelCount":    1,
                "audioType":       "SPEECH",
                "encoding":        "base64"
            }
        }}})

        print("✅ Echo session open — speak into your microphone!")
        print("   Press Ctrl+C to end.\n" + "-" * 50)

    async def end_session(self):
        if not self.is_active:
            return
        self.is_active = False
        try:
            await self._send({"event": {"contentEnd": {
                "promptName":  self.prompt_name,
                "contentName": self.audio_content
            }}})
            await self._send({"event": {"promptEnd":  {"promptName": self.prompt_name}}})
            await self._send({"event": {"sessionEnd": {}}})
            await self.stream_response.input_stream.close()
        except Exception as e:
            print(f"[end_session] {e}")

    # ── Send mic audio ────────────────────────────────────────────────────────
    async def send_audio(self, pcm_bytes: bytes):
        await self._send({"event": {"audioInput": {
            "promptName":  self.prompt_name,
            "contentName": self.audio_content,
            "content":     base64.b64encode(pcm_bytes).decode("utf-8")
        }}})

    # ── Receive responses — CORRECT PATTERN: await_output() + receive() ───────
    async def receive_responses(self):
        try:
            while self.is_active:
                try:
                    # ✅ Official AWS pattern — NOT "async for event in output_stream"
                    output = await self.stream_response.await_output()
                    result = await output[1].receive()

                    if result.value and result.value.bytes_:
                        decoded    = json.loads(result.value.bytes_.decode("utf-8"))
                        event_data = decoded.get("event", {})

                        # Audio chunk → play queue
                        if "audioOutput" in event_data:
                            b64 = event_data["audioOutput"].get("content", "")
                            if b64:
                                self._audio_out_queue.put(base64.b64decode(b64))

                        # Transcript
                        if "textOutput" in event_data:
                            text = event_data["textOutput"].get("content", "").strip()
                            role = event_data["textOutput"].get("role", "")
                            if text:
                                label = "👤 You" if role == "USER" else "⚖️  Echo"
                                print(f"\n{label}: {text}")

                        # Debug markers
                        if "contentEnd" in event_data:
                            stop = event_data["contentEnd"].get("stopReason", "")
                            if stop:
                                print(f"[debug] contentEnd — stopReason: {stop}")

                except Exception as inner:
                    err = str(inner)
                    if "Timed out" in err or "timed out" in err:
                        continue          # normal keepalive timeout — ignore
                    if self.is_active:
                        print(f"[receive_err] {type(inner).__name__}: {inner}")
                    break

        except Exception as outer:
            print(f"[stream_err] {type(outer).__name__}: {outer}")
        finally:
            self.is_active = False


# ── Playback thread ───────────────────────────────────────────────────────────
def player_thread(out_queue: queue.Queue, stop_ev: threading.Event):
    print("🔊 Playback ready")
    with sd.RawOutputStream(
        samplerate=OUTPUT_SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=CHUNK_FRAMES,
    ) as stream:
        while not stop_ev.is_set():
            try:
                pcm = out_queue.get(timeout=0.05)
                stream.write(pcm)
            except queue.Empty:
                continue


# ── Mic thread ────────────────────────────────────────────────────────────────
def mic_thread(mic_queue: queue.Queue, stop_ev: threading.Event):
    print("🎙️  Microphone active")
    with sd.RawInputStream(
        samplerate=INPUT_SAMPLE_RATE,
        channels=CHANNELS,
        dtype="int16",
        blocksize=CHUNK_FRAMES,
    ) as stream:
        while not stop_ev.is_set():
            try:
                data, _ = stream.read(CHUNK_FRAMES)
                mic_queue.put(bytes(data))
            except Exception as e:
                print(f"[mic_err] {e}")
                continue


# ── Main loop ─────────────────────────────────────────────────────────────────
async def run_echo_voice_session():
    engine  = EchoVoiceEngine()
    stop_ev = threading.Event()

    # Threads
    threading.Thread(target=mic_thread,    args=(engine._mic_queue, stop_ev),         daemon=True).start()
    threading.Thread(target=player_thread, args=(engine._audio_out_queue, stop_ev),   daemon=True).start()

    await engine.start_session()
    receive_task = asyncio.create_task(engine.receive_responses())

    try:
        while engine.is_active:
            if not engine._mic_queue.empty():
                await engine.send_audio(engine._mic_queue.get_nowait())
            else:
                await asyncio.sleep(0.01)

    except KeyboardInterrupt:
        print("\n🛑  Stopping Echo...")

    except Exception as e:
        print(f"[main_err] {type(e).__name__}: {e}")

    finally:
        await engine.end_session()
        stop_ev.set()
        if not receive_task.done():
            receive_task.cancel()
            try:
                await receive_task
            except asyncio.CancelledError:
                pass
        print("\n✅  Echo session ended. Goodbye!\n")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("\n" + "=" * 55)
    print("  ⚖️   ECHO — AI Legal Aid Voice Assistant")
    print("  Powered by Amazon Nova 2 Sonic")
    print("=" * 55 + "\n")
    asyncio.run(run_echo_voice_session())