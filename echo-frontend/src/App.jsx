import { useState, useEffect, useRef, useCallback } from "react";

// ── Audio helpers ─────────────────────────────────────────────────────────────
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Resample Float32 audio from browser rate (48kHz) down to 16kHz for Nova Sonic
function downsample(buffer, fromRate, toRate) {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    result[i] = buffer[Math.round(i * ratio)];
  }
  return result;
}

// Convert Float32 PCM → Int16 PCM → Base64
function float32ToB64(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// Decode base64 PCM → Float32 for AudioContext playback
function b64ToFloat32(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 32768;
  return float;
}

// ── Document Upload Panel Component ──────────────────────────────────────────
function DocumentPanel({ userId, sessionId, onAnalysis }) {
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("user_id", userId);
    formData.append("session_id", sessionId);

    try {
      const res = await fetch("http://localhost:8000/documents/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setDocuments((prev) => [...prev, data]);
        onAnalysis(data); // pass analysis up to parent for voice response
      } else {
        alert(`Upload failed: ${data.detail}`);
      }
    } catch (e) {
      alert(`Upload error: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFile(e.dataTransfer.files[0]);
  };

  return (
    <div className="w-full">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">
        Upload Documents
      </h2>

      {/* Drop zone */}
      <label
        className={`
          flex flex-col items-center justify-center w-full h-28 rounded-xl border-2
          border-dashed cursor-pointer transition-all
          ${
            dragOver
              ? "border-blue-400 bg-blue-950"
              : "border-slate-600 bg-slate-800 hover:bg-slate-750 hover:border-slate-500"
          }
          ${uploading ? "opacity-50 cursor-not-allowed" : ""}
        `}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          disabled={uploading}
          onChange={(e) => uploadFile(e.target.files?.[0])}
        />
        <span className="text-2xl mb-1">{uploading ? "⏳" : "📎"}</span>
        <span className="text-sm text-slate-400">
          {uploading ? "Analyzing document..." : "Drop PDF or photo here"}
        </span>
        <span className="text-xs text-slate-600 mt-1">
          Eviction notices · Leases · Pay stubs · Court notices
        </span>
      </label>

      {/* Uploaded documents list */}
      {documents.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {documents.map((doc, i) => (
            <div key={i} className="bg-slate-800 rounded-lg p-3 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span>📄</span>
                <span className="font-medium text-slate-200 truncate">
                  {doc.filename}
                </span>
                <span className="ml-auto text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
                  {doc.doc_type}
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {doc.analysis?.summary || doc.message}
              </p>
              {doc.analysis?.urgency_flags?.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {doc.analysis.urgency_flags.map((flag, j) => (
                    <span
                      key={j}
                      className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded"
                    >
                      ⚠️ {flag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus] = useState("idle"); // idle | connecting | ready | listening | speaking | error
  const [transcript, setTranscript] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [userId] = useState(() => `user_${Date.now()}`);
  const [sessionId] = useState(() => `session_${Date.now()}`);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const nextPlayTime = useRef(0);

  // ── Play audio chunk from Nova Sonic ───────────────────────────────────────
  const playAudioChunk = useCallback((b64) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const float32 = b64ToFloat32(b64);
    const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Queue chunks seamlessly — no gaps or overlaps
    const startAt = Math.max(ctx.currentTime, nextPlayTime.current);
    source.start(startAt);
    nextPlayTime.current = startAt + buffer.duration;
  }, []);

  // ── Start voice session ────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setStatus("connecting");
    setTranscript([]);
    setErrorMsg("");

    // AudioContext for playback
    audioCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    nextPlayTime.current = 0;

    // Open WebSocket
    const ws = new WebSocket(`ws://localhost:8000/ws/voice`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start" }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "ready") {
        setStatus("listening");
        // Start mic capture
        await startMicCapture(ws);
      } else if (msg.type === "audio") {
        setStatus("speaking");
        playAudioChunk(msg.data);
        // Return to listening after audio queued
        setTimeout(
          () => setStatus((s) => (s === "speaking" ? "listening" : s)),
          500,
        );
      } else if (msg.type === "transcript") {
        setTranscript((prev) => [...prev, { role: msg.role, text: msg.text }]);
      } else if (msg.type === "error") {
        setErrorMsg(msg.message);
        setStatus("error");
      } else if (msg.type === "done") {
        setStatus("listening");
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("WebSocket connection failed. Is the backend running?");
    };

    ws.onclose = () => {
      if (status !== "idle") setStatus("idle");
    };
  }, [playAudioChunk]);

  // ── Mic capture → WebSocket ────────────────────────────────────────────────
  const startMicCapture = async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const ctx = new AudioContext(); // browser's native rate (48kHz)
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const resampled = downsample(raw, ctx.sampleRate, INPUT_SAMPLE_RATE);
      const b64 = float32ToB64(resampled);
      ws.send(JSON.stringify({ type: "audio", data: b64 }));
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  };

  // ── Stop session ───────────────────────────────────────────────────────────
  const stopSession = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    setStatus("idle");
  }, []);

  useEffect(() => () => stopSession(), []);

  // ── Status config ──────────────────────────────────────────────────────────
  const statusConfig = {
    idle: {
      color: "bg-slate-700",
      ring: "",
      label: "Click to start",
      pulse: false,
    },
    connecting: {
      color: "bg-yellow-500",
      ring: "ring-4 ring-yellow-300",
      label: "Connecting...",
      pulse: true,
    },
    listening: {
      color: "bg-blue-500",
      ring: "ring-4 ring-blue-300",
      label: "Listening...",
      pulse: true,
    },
    speaking: {
      color: "bg-green-500",
      ring: "ring-4 ring-green-300",
      label: "Echo is speaking",
      pulse: true,
    },
    error: {
      color: "bg-red-500",
      ring: "ring-4 ring-red-300",
      label: "Error",
      pulse: false,
    },
  };
  const cfg = statusConfig[status] || statusConfig.idle;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center">
      {/* ── Header ── */}
      <header className="w-full px-6 py-4 flex items-center gap-3 border-b border-slate-700">
        <span className="text-2xl">⚖️</span>
        <div>
          <h1 className="font-bold text-lg leading-tight">Echo Legal AI</h1>
          <p className="text-xs text-slate-400">
            Powered by Amazon Nova 2 Sonic
          </p>
        </div>
        <div className="ml-auto">
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium
            ${
              status === "listening"
                ? "bg-blue-900 text-blue-300"
                : status === "speaking"
                  ? "bg-green-900 text-green-300"
                  : status === "error"
                    ? "bg-red-900 text-red-300"
                    : "bg-slate-700 text-slate-400"
            }`}
          >
            {status.toUpperCase()}
          </span>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="flex-1 w-full max-w-2xl flex flex-col items-center px-4 py-8 gap-8">
        {/* ── Voice Orb ── */}
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={
              status === "idle" || status === "error"
                ? startSession
                : stopSession
            }
            className={`
              w-36 h-36 rounded-full transition-all duration-300 shadow-2xl
              flex items-center justify-center text-5xl
              ${cfg.color} ${cfg.ring}
              ${cfg.pulse ? "animate-pulse" : ""}
              hover:scale-105 active:scale-95 cursor-pointer
            `}
          >
            {status === "idle"
              ? "🎙️"
              : status === "connecting"
                ? "⏳"
                : status === "listening"
                  ? "👂"
                  : status === "speaking"
                    ? "🔊"
                    : status === "error"
                      ? "❌"
                      : "🎙️"}
          </button>
          <p className="text-slate-400 text-sm font-medium">{cfg.label}</p>
          {status !== "idle" && status !== "error" && (
            <button
              onClick={stopSession}
              className="text-xs text-slate-500 hover:text-red-400 transition-colors underline"
            >
              End session
            </button>
          )}
        </div>

        {/* ── Error message ── */}
        {errorMsg && (
          <div className="w-full bg-red-950 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* ── Instructions (idle state) ── */}
        {status === "idle" && (
          <div className="w-full bg-slate-800 rounded-2xl p-6 text-center">
            <p className="text-slate-300 text-sm leading-relaxed">
              Echo is your AI legal aid assistant. Speak about your legal
              situation — eviction, wage theft, immigration — and Echo will
              guide you through your rights.
            </p>
            <p className="text-slate-500 text-xs mt-3">
              🌐 Supports English & Spanish &nbsp;·&nbsp; 🔒 Your conversation
              is private &nbsp;·&nbsp; ⚖️ Always consult an attorney for final
              decisions
            </p>
          </div>
        )}

        {/* ── Transcript ── */}
        {transcript.length > 0 && (
          <div className="w-full flex flex-col gap-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              Conversation
            </h2>
            <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
              {transcript.map((t, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${t.role === "USER" ? "flex-row-reverse" : "flex-row"}`}
                >
                  <div className="text-xl shrink-0">
                    {t.role === "USER" ? "👤" : "⚖️"}
                  </div>
                  <div
                    className={`
                    px-4 py-2 rounded-2xl text-sm max-w-xs leading-relaxed
                    ${
                      t.role === "USER"
                        ? "bg-blue-600 text-white rounded-tr-sm"
                        : "bg-slate-700 text-slate-100 rounded-tl-sm"
                    }
                  `}
                  >
                    {t.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Document Upload ── */}
        <DocumentPanel
          userId={userId}
          sessionId={sessionId}
          onAnalysis={(data) => {
            setTranscript((prev) => [
              ...prev,
              {
                role: "ASSISTANT",
                text: `📎 Document analyzed: ${data.analysis?.summary || data.message}`,
              },
            ]);
          }}
        />
      </main>

      {/* ── Footer ── */}
      <footer className="w-full py-3 text-center text-xs text-slate-600 border-t border-slate-800">
        Built with Amazon Nova 2 Sonic · Nova 2 Lite · Nova Multimodal
        Embeddings · Nova Act
      </footer>
    </div>
  );
}
