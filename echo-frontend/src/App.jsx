import { useState, useEffect, useRef, useCallback } from "react";

// ── Audio constants ───────────────────────────────────────────────────────────
const INPUT_SAMPLE_RATE = 16000; // sent to Nova Sonic
const OUTPUT_SAMPLE_RATE = 24000; // received from Nova Sonic

// Downsample Float32 from browser native (48kHz) to 16kHz for Nova Sonic
function downsample(buffer, fromRate, toRate) {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) result[i] = buffer[Math.round(i * ratio)];
  return result;
}

// Float32 PCM → Int16 PCM → Base64
function float32ToB64(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// Base64 → Int16 PCM → Float32
function b64ToFloat32(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer);
  const float = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 32768;
  return float;
}

// ── Progress Steps ────────────────────────────────────────────────────────────
const PROGRESS_STEPS = [
  { id: "intake", label: "Intake", icon: "🎙️" },
  { id: "analyze", label: "Analysis", icon: "🧠" },
  { id: "document", label: "Documents", icon: "📎" },
  { id: "draft", label: "Draft", icon: "✍️" },
  { id: "file", label: "Filing", icon: "🤖" },
];

function ProgressBar({ currentStep }) {
  const currentIdx = PROGRESS_STEPS.findIndex((s) => s.id === currentStep);
  return (
    <div className="w-full flex items-center justify-between px-1">
      {PROGRESS_STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm
                transition-all duration-500
                ${
                  done
                    ? "bg-green-600 text-white"
                    : active
                      ? "bg-blue-600 text-white ring-4 ring-blue-900"
                      : "bg-slate-700 text-slate-500"
                }`}
              >
                {done ? "✓" : step.icon}
              </div>
              <span
                className={`text-xs ${active ? "text-blue-400" : done ? "text-green-400" : "text-slate-600"}`}
              >
                {step.label}
              </span>
            </div>
            {i < PROGRESS_STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 mb-4 transition-all duration-500
                ${i < currentIdx ? "bg-green-600" : "bg-slate-700"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function VoiceOrb({ status, onClick }) {
  const cfg = {
    idle: { bg: "bg-slate-700", ring: "", icon: "🎙️", pulse: false },
    connecting: {
      bg: "bg-yellow-500",
      ring: "ring-4 ring-yellow-900",
      icon: "⏳",
      pulse: true,
    },
    listening: {
      bg: "bg-blue-600",
      ring: "ring-4 ring-blue-900",
      icon: "👂",
      pulse: true,
    },
    speaking: {
      bg: "bg-green-600",
      ring: "ring-4 ring-green-900",
      icon: "🔊",
      pulse: true,
    },
    thinking: {
      bg: "bg-purple-600",
      ring: "ring-4 ring-purple-900",
      icon: "🧠",
      pulse: true,
    },
    paused: {
      bg: "bg-amber-600",
      ring: "ring-4 ring-amber-900",
      icon: "⏸️",
      pulse: false,
    },
    error: {
      bg: "bg-red-600",
      ring: "ring-4 ring-red-900",
      icon: "❌",
      pulse: false,
    },
  }[status] || { bg: "bg-slate-700", ring: "", icon: "🎙️", pulse: false };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={onClick}
        className={`w-32 h-32 rounded-full flex items-center justify-center text-5xl
          shadow-2xl transition-all duration-300 cursor-pointer
          ${cfg.bg} ${cfg.ring} ${cfg.pulse ? "animate-pulse" : ""}
          hover:scale-105 active:scale-95`}
      >
        {cfg.icon}
      </button>
      <span className="text-xs text-slate-400 font-medium tracking-wide uppercase">
        {status === "idle"
          ? "Tap to begin"
          : status === "connecting"
            ? "Connecting..."
            : status === "listening"
              ? "Listening..."
              : status === "speaking"
                ? "Echo is speaking"
                : status === "thinking"
                  ? "Analyzing..."
                  : status === "paused"
                    ? "Mic paused"
                    : status === "error"
                      ? "Error — tap to retry"
                      : ""}
      </span>
    </div>
  );
}

function TranscriptBubble({ role, text }) {
  const isUser = role === "USER";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <span className="text-lg shrink-0 mt-1">{isUser ? "👤" : "⚖️"}</span>
      <div
        className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed max-w-xs
        ${
          isUser
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-slate-700 text-slate-100 rounded-tl-sm"
        }`}
      >
        {text}
      </div>
    </div>
  );
}

// ── Document Upload Panel ─────────────────────────────────────────────────────
function DocumentPanel({ userId, sessionId, onAnalysis }) {
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = async (file) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("user_id", userId);
    form.append("session_id", sessionId);
    try {
      const res = await fetch("http://localhost:8000/documents/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setDocuments((d) => [...d, data]);
        onAnalysis(data);
      } else alert(`Upload failed: ${data.detail}`);
    } catch (e) {
      alert(`Upload error: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="w-full">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
        📎 Upload Documents
      </h3>
      <label
        className={`flex flex-col items-center justify-center w-full h-24 rounded-xl
          border-2 border-dashed cursor-pointer transition-all
          ${
            dragOver
              ? "border-blue-400 bg-blue-950"
              : uploading
                ? "border-slate-600 bg-slate-800 opacity-50 cursor-wait"
                : "border-slate-600 bg-slate-800 hover:border-slate-500"
          }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          uploadFile(e.dataTransfer.files[0]);
        }}
      >
        <input
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp"
          disabled={uploading}
          onChange={(e) => uploadFile(e.target.files?.[0])}
        />
        <span className="text-xl mb-1">{uploading ? "⏳" : "📄"}</span>
        <span className="text-xs text-slate-400">
          {uploading
            ? "Analyzing with Nova..."
            : "Drop PDF, photo, or notice here"}
        </span>
      </label>
      {documents.map((doc, i) => (
        <div key={i} className="mt-2 bg-slate-800 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm">📄</span>
            <span className="text-xs font-medium text-slate-200 truncate flex-1">
              {doc.filename}
            </span>
            <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full shrink-0">
              {doc.doc_type}
            </span>
          </div>
          {doc.analysis?.summary && (
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              {doc.analysis.summary}
            </p>
          )}
          {doc.analysis?.urgency_flags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {doc.analysis.urgency_flags.map((f, j) => (
                <span
                  key={j}
                  className="text-xs bg-red-900 text-red-300 px-1.5 py-0.5 rounded"
                >
                  ⚠️ {f}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Nova Act Filing Panel ─────────────────────────────────────────────────────
function FilingPanel({ sessionId, issueType, issueSummary }) {
  const [phase, setPhase] = useState("idle");
  const [steps, setSteps] = useState([]);
  const [confirm, setConfirm] = useState("");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    state: "",
    city: "",
  });

  const startFiling = async (workflowName) => {
    if (!form.firstName || !form.email || !form.state) {
      alert("First Name, Email, and State are required.");
      return;
    }
    setPhase("running");
    setSteps([]);
    setConfirm("");
    try {
      const res = await fetch("http://localhost:8000/nova-act/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow_name: workflowName,
          session_id: sessionId,
          first_name: form.firstName,
          last_name: form.lastName,
          email: form.email,
          phone: form.phone,
          state: form.state,
          city: form.city,
          issue_type: issueType || "OTHER",
          issue_summary: issueSummary || "Legal assistance needed.",
        }),
      });
      const data = await res.json();
      const jobId = data.job_id;
      const evtSrc = new EventSource(
        `http://localhost:8000/nova-act/stream/${jobId}`,
      );
      evtSrc.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "step") {
          setSteps((prev) => {
            const idx = prev.findIndex((s) => s.step_num === msg.step.step_num);
            if (idx >= 0) {
              const u = [...prev];
              u[idx] = msg.step;
              return u;
            }
            return [...prev, msg.step];
          });
        }
        if (msg.type === "complete") {
          setPhase(msg.job.status === "done" ? "done" : "failed");
          setConfirm(msg.job.confirmation || msg.job.error);
          evtSrc.close();
        }
      };
      evtSrc.onerror = () => {
        setPhase("failed");
        evtSrc.close();
      };
    } catch (e) {
      setPhase("failed");
      setConfirm(`Error: ${e.message}`);
    }
  };

  if (phase === "idle")
    return (
      <div className="w-full">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
          🤖 Autonomous Filing
        </h3>
        <button
          onClick={() => setPhase("form")}
          className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500
                   text-white font-semibold text-sm transition-colors"
        >
          File with Legal Aid Automatically
        </button>
      </div>
    );

  if (phase === "form")
    return (
      <div className="w-full">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
          🤖 Your Details
        </h3>
        <div className="bg-slate-800 rounded-xl p-4 flex flex-col gap-2">
          {[
            ["firstName", "First Name *"],
            ["lastName", "Last Name"],
            ["email", "Email *"],
            ["phone", "Phone"],
            ["state", "State (e.g. California) *"],
            ["city", "City"],
          ].map(([k, label]) => (
            <input
              key={k}
              placeholder={label}
              value={form[k]}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              className="bg-slate-700 rounded-lg px-3 py-2 text-sm text-white
                       placeholder-slate-500 outline-none focus:ring-1 focus:ring-blue-500"
            />
          ))}
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => startFiling("legalaid")}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500
                       text-white text-xs font-semibold transition-colors"
            >
              📋 LegalAid Intake
            </button>
            <button
              onClick={() => startFiling("benefits")}
              className="flex-1 py-2 rounded-lg bg-green-700 hover:bg-green-600
                       text-white text-xs font-semibold transition-colors"
            >
              🏛️ Find Benefits
            </button>
          </div>
          <button
            onClick={() => setPhase("idle")}
            className="text-xs text-slate-500 hover:text-slate-300 mt-1"
          >
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <div className="w-full">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
        🤖 Filing Progress
      </h3>
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex items-start gap-2 bg-slate-800 rounded-lg px-3 py-2"
          >
            <span className="text-sm shrink-0">
              {step.status === "running"
                ? "⏳"
                : step.status === "done"
                  ? "✅"
                  : "❌"}
            </span>
            <div>
              <p className="text-xs text-slate-300">{step.description}</p>
              {step.result && step.status === "done" && (
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                  {step.result.slice(0, 80)}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {confirm && (
        <div
          className={`mt-3 rounded-xl p-3 text-xs leading-relaxed
          ${
            phase === "done"
              ? "bg-green-950 border border-green-700 text-green-300"
              : "bg-red-950  border border-red-700  text-red-300"
          }`}
        >
          {phase === "done" ? "🎉 " : "⚠️ "}
          {confirm.slice(0, 400)}
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [voiceStatus, setVoiceStatus] = useState("idle");
  const [transcript, setTranscript] = useState([]);
  const [agentResult, setAgentResult] = useState(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [progressStep, setProgressStep] = useState("intake");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState("voice");
  const [micPaused, setMicPaused] = useState(false);

  const [userId] = useState(() => `user_${Date.now()}`);
  const [sessionId] = useState(() => `session_${Date.now()}`);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const micCtxRef = useRef(null); // separate AudioContext for mic capture
  const nextPlayTime = useRef(0);
  const transcriptRef = useRef([]); // always up-to-date copy for callbacks

  // Keep transcriptRef in sync
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // ── FIXED: Play audio chunk from Nova Sonic ──────────────────────────────
  const playChunk = useCallback((b64) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    // Resume AudioContext — Chrome suspends it until user gesture
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const float32 = b64ToFloat32(b64);

    // Create buffer at OUTPUT_SAMPLE_RATE (24000) regardless of ctx rate.
    // The browser handles resampling to the device's native rate automatically.
    const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Guard against stale nextPlayTime (e.g. after a long silence)
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextPlayTime.current); // 20ms buffer
    source.start(startAt);
    nextPlayTime.current = startAt + buffer.duration;
  }, []);

  // ── Trigger agents pipeline with current transcript ──────────────────────
  const runAgentAnalysis = useCallback(
    async (transcriptToAnalyze) => {
      if (!transcriptToAnalyze || transcriptToAnalyze.length === 0) return;

      // Build a combined user message from all USER turns
      const userText = transcriptToAnalyze
        .filter((t) => t.role === "USER")
        .map((t) => t.text)
        .join(" ");

      if (!userText.trim()) return;

      setAgentLoading(true);
      setProgressStep("analyze");

      try {
        const res = await fetch("http://localhost:8000/agents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, message: userText }),
        });
        const data = await res.json();
        setAgentResult(data);

        if (data.classification?.urgency === "CRITICAL" || data.document) {
          setProgressStep("draft");
        } else if (data.classification?.category) {
          setProgressStep("analyze");
        }

        // Append agent's text response to transcript
        if (data.response_text) {
          setTranscript((prev) => [
            ...prev,
            { role: "ASSISTANT", text: data.response_text },
          ]);
        }
      } catch (e) {
        console.error("Agent analysis error:", e);
      } finally {
        setAgentLoading(false);
      }
    },
    [sessionId],
  );

  // ── Stop & Analyze button handler ─────────────────────────────────────────
  const handleStopAndAnalyze = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    // 1. Tell backend to stop forwarding mic audio to Nova Sonic
    wsRef.current.send(JSON.stringify({ type: "pause_mic" }));
    setMicPaused(true);
    setVoiceStatus("paused");

    // 2. Run agent analysis with current transcript
    runAgentAnalysis(transcriptRef.current);

    // 3. Switch to analysis tab automatically
    setActiveTab("voice");
  }, [runAgentAnalysis]);

  // ── Resume listening after analysis ─────────────────────────────────────
  const handleResumeListening = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "resume_mic" }));
    setMicPaused(false);
    setVoiceStatus("listening");
  }, []);

  // ── Start voice session ───────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setVoiceStatus("connecting");
    setTranscript([]);
    setAgentResult(null);
    setAgentLoading(false);
    setProgressStep("intake");
    setErrorMsg("");
    setMicPaused(false);

    // Create AudioContext WITHOUT forcing a sample rate.
    // Browser picks its native rate (44100 or 48000).
    // Buffers will be created at 24000Hz and browser resamples on playback.
    audioCtxRef.current = new AudioContext();
    nextPlayTime.current = 0;

    const ws = new WebSocket("ws://localhost:8000/ws/voice");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start" }));
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "ready":
          setVoiceStatus("listening");
          await startMicCapture(ws);
          break;

        case "audio":
          // Set status to speaking only when audio actually arrives
          setVoiceStatus("speaking");
          playChunk(msg.data);
          // Return to listening after roughly the chunk's expected play duration
          setTimeout(
            () => setVoiceStatus((s) => (s === "speaking" ? "listening" : s)),
            600,
          );
          break;

        case "transcript":
          setTranscript((prev) => [
            ...prev,
            { role: msg.role, text: msg.text },
          ]);
          if (msg.role === "ASSISTANT") setProgressStep("analyze");
          break;

        case "mic_paused":
          console.log("[ws] Mic pause confirmed by server");
          break;

        case "mic_resumed":
          console.log("[ws] Mic resume confirmed by server");
          break;

        case "error":
          setErrorMsg(msg.message);
          setVoiceStatus("error");
          break;

        case "done":
          if (!micPaused) setVoiceStatus("listening");
          break;

        default:
          break;
      }
    };

    ws.onerror = () => {
      setVoiceStatus("error");
      setErrorMsg(
        "Could not connect to backend. Is the server running on port 8000?",
      );
    };

    ws.onclose = () => {
      setVoiceStatus((s) => (s !== "error" ? "idle" : s));
    };
  }, [playChunk, micPaused]);

  // ── Mic capture → base64 PCM → WebSocket ─────────────────────────────────
  const startMicCapture = async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    // Use a separate AudioContext for mic capture so we know its actual rate
    const ctx = new AudioContext();
    micCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const resampled = downsample(raw, ctx.sampleRate, INPUT_SAMPLE_RATE);
      const b64 = float32ToB64(resampled);
      ws.send(JSON.stringify({ type: "audio", data: b64 }));
    };

    source.connect(processor);
    processor.connect(ctx.destination);
  };

  // ── Stop session entirely ─────────────────────────────────────────────────
  const stopSession = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "stop" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    micCtxRef.current?.close();
    micCtxRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setVoiceStatus("idle");
    setMicPaused(false);
    setProgressStep("intake");
  }, []);

  useEffect(() => () => stopSession(), []);

  const isActive = !["idle", "error"].includes(voiceStatus);
  const canAnalyze =
    isActive && !micPaused && transcript.some((t) => t.role === "USER");
  const showResumeBtn = micPaused;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {/* ── Header ── */}
      <header
        className="w-full px-5 py-3 flex items-center gap-3
                         border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-10"
      >
        <span className="text-2xl">⚖️</span>
        <div>
          <h1 className="font-bold text-base leading-tight">Echo Legal AI</h1>
          <p className="text-xs text-slate-500">
            Amazon Nova · Free Legal Aid for Everyone
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isActive && (
            <button
              onClick={stopSession}
              className="text-xs px-3 py-1.5 rounded-full bg-red-900 text-red-300
                         hover:bg-red-800 transition-colors"
            >
              End Session
            </button>
          )}
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium
            ${
              voiceStatus === "listening"
                ? "bg-blue-900 text-blue-300"
                : voiceStatus === "speaking"
                  ? "bg-green-900 text-green-300"
                  : voiceStatus === "thinking"
                    ? "bg-purple-900 text-purple-300"
                    : voiceStatus === "paused"
                      ? "bg-amber-900 text-amber-300"
                      : voiceStatus === "error"
                        ? "bg-red-900 text-red-300"
                        : "bg-slate-700 text-slate-400"
            }`}
          >
            {voiceStatus.toUpperCase()}
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto flex flex-col items-center px-4 py-6 gap-5">
        {/* ── Progress Bar ── */}
        <ProgressBar currentStep={progressStep} />

        {/* ── Voice Orb ── */}
        <VoiceOrb
          status={voiceStatus}
          onClick={isActive ? stopSession : startSession}
        />

        {/* ── Stop & Analyze / Resume Buttons ── */}
        {isActive && (
          <div className="w-full flex gap-2">
            {!micPaused ? (
              <button
                onClick={handleStopAndAnalyze}
                disabled={!canAnalyze || agentLoading}
                className={`flex-1 py-3 rounded-xl font-semibold text-sm
                  transition-all duration-200 flex items-center justify-center gap-2
                  ${
                    canAnalyze && !agentLoading
                      ? "bg-purple-700 hover:bg-purple-600 text-white cursor-pointer"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
              >
                {agentLoading ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Analyzing with Nova...
                  </>
                ) : (
                  <>
                    <span>🧠</span>
                    Stop & Analyze
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleResumeListening}
                className="flex-1 py-3 rounded-xl bg-blue-700 hover:bg-blue-600
                           text-white font-semibold text-sm transition-colors
                           flex items-center justify-center gap-2"
              >
                <span>🎙️</span>
                Resume Listening
              </button>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {errorMsg && (
          <div className="w-full bg-red-950 border border-red-800 rounded-xl p-3 text-xs text-red-300">
            ⚠️ {errorMsg}
          </div>
        )}

        {/* ── Idle welcome card ── */}
        {voiceStatus === "idle" && transcript.length === 0 && (
          <div className="w-full bg-slate-800 rounded-2xl p-5 text-center">
            <p className="text-slate-300 text-sm leading-relaxed">
              Echo is your free AI legal aid assistant. Describe your situation
              — eviction, unpaid wages, immigration, family law — and Echo will
              explain your rights, draft legal letters, and file with legal aid
              automatically.
            </p>
            <div className="flex justify-center gap-4 mt-4 text-xs text-slate-500">
              <span>🌐 English & Spanish</span>
              <span>🔒 Private</span>
              <span>💸 Free</span>
            </div>
            <p className="text-xs text-slate-600 mt-3">
              After speaking, click{" "}
              <strong className="text-slate-400">🧠 Stop & Analyze</strong> to
              run the full legal analysis pipeline.
            </p>
          </div>
        )}

        {/* ── Tabs ── */}
        {(isActive || transcript.length > 0) && (
          <div className="w-full">
            <div className="flex rounded-xl overflow-hidden border border-slate-700 mb-4">
              {[
                { id: "voice", label: "💬 Conversation" },
                { id: "docs", label: "📎 Documents" },
                { id: "file", label: "🤖 File" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors
                    ${
                      activeTab === tab.id
                        ? "bg-slate-700 text-white"
                        : "bg-slate-800 text-slate-500 hover:text-slate-300"
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Conversation Tab ── */}
            {activeTab === "voice" && (
              <div className="flex flex-col gap-3">
                {/* Live transcript */}
                <div className="flex flex-col gap-3 max-h-64 overflow-y-auto pr-1">
                  {transcript.length === 0 ? (
                    <p className="text-center text-slate-500 text-sm py-8">
                      Start speaking — Echo is listening...
                    </p>
                  ) : (
                    transcript.map((t, i) => (
                      <TranscriptBubble key={i} role={t.role} text={t.text} />
                    ))
                  )}
                </div>

                {/* Agent Analysis Card */}
                {agentLoading && (
                  <div className="bg-slate-800 rounded-xl p-4 border border-purple-800 animate-pulse">
                    <p className="text-xs text-purple-400 flex items-center gap-2">
                      <span className="animate-spin">⏳</span>
                      Running legal analysis through Nova Lite agents...
                    </p>
                  </div>
                )}

                {agentResult && !agentLoading && (
                  <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 mb-3">
                      🧠 Echo's Legal Analysis
                    </p>

                    {/* Category + Urgency badges */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {agentResult.classification?.category && (
                        <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-lg">
                          {agentResult.classification.category}
                        </span>
                      )}
                      {agentResult.classification?.urgency && (
                        <span
                          className={`text-xs px-2 py-1 rounded-lg
                          ${
                            agentResult.classification.urgency === "CRITICAL"
                              ? "bg-red-900 text-red-300"
                              : agentResult.classification.urgency === "HIGH"
                                ? "bg-orange-900 text-orange-300"
                                : "bg-slate-700 text-slate-300"
                          }`}
                        >
                          {agentResult.classification.urgency} urgency
                        </span>
                      )}
                      {agentResult.eligibility?.qualifies_for_legal_aid && (
                        <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded-lg">
                          ✅ Qualifies for legal aid
                        </span>
                      )}
                    </div>

                    {/* Summary */}
                    {agentResult.classification?.summary && (
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">
                        {agentResult.classification.summary}
                      </p>
                    )}

                    {/* Next steps */}
                    {agentResult.eligibility?.next_steps?.length > 0 && (
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-slate-500 mb-1">
                          Next Steps:
                        </p>
                        <ul className="space-y-1">
                          {agentResult.eligibility.next_steps
                            .slice(0, 3)
                            .map((s, i) => (
                              <li
                                key={i}
                                className="text-xs text-slate-400 flex gap-1"
                              >
                                <span className="text-green-500 shrink-0">
                                  →
                                </span>{" "}
                                {s}
                              </li>
                            ))}
                        </ul>
                      </div>
                    )}

                    {/* Document drafted */}
                    {agentResult.document && (
                      <div className="pt-2 border-t border-slate-700">
                        <p className="text-xs text-green-400 flex items-center gap-1">
                          ✍️ Legal letter drafted
                          <span className="text-slate-500">
                            — switch to File tab to submit
                          </span>
                        </p>
                      </div>
                    )}

                    {/* Time-sensitive warning */}
                    {agentResult.eligibility?.time_sensitive_actions &&
                      agentResult.eligibility.time_sensitive_actions !==
                        "NONE" && (
                        <div className="mt-2 bg-red-950 border border-red-800 rounded-lg p-2">
                          <p className="text-xs text-red-300">
                            ⚠️ {agentResult.eligibility.time_sensitive_actions}
                          </p>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            {/* ── Documents Tab ── */}
            {activeTab === "docs" && (
              <DocumentPanel
                userId={userId}
                sessionId={sessionId}
                onAnalysis={(data) => {
                  setTranscript((prev) => [
                    ...prev,
                    {
                      role: "ASSISTANT",
                      text: `📎 I've analyzed your document. ${data.analysis?.summary || data.message}`,
                    },
                  ]);
                  setProgressStep("document");
                }}
              />
            )}

            {/* ── Filing Tab ── */}
            {activeTab === "file" && (
              <FilingPanel
                sessionId={sessionId}
                issueType={agentResult?.classification?.category || "OTHER"}
                issueSummary={agentResult?.classification?.summary || ""}
              />
            )}
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="py-3 text-center text-xs text-slate-700 border-t border-slate-800">
        Echo · Amazon Nova 2 Sonic · Nova Lite APAC · Titan Embeddings · Nova
        Act &nbsp;·&nbsp; ⚖️ Always consult a licensed attorney for final
        decisions
      </footer>
    </div>
  );
}
