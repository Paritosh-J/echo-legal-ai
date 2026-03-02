import { useState, useEffect, useRef, useCallback } from "react";

// ── Audio constants ───────────────────────────────────────────────────────────
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

function downsample(buffer, fromRate, toRate) {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) result[i] = buffer[Math.round(i * ratio)];
  return result;
}

function float32ToB64(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
  const bytes = new Uint8Array(int16.buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

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

// ── Progress Bar ──────────────────────────────────────────────────────────────
function ProgressBar({ currentStep }) {
  const currentIdx = PROGRESS_STEPS.findIndex((s) => s.id === currentStep);
  return (
    <div className="w-full flex items-center justify-between px-2">
      {PROGRESS_STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        const pending = i > currentIdx;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center gap-1">
              <div
                className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm
                transition-all duration-500
                ${
                  done
                    ? "bg-green-600 text-white"
                    : active
                      ? "bg-blue-600 text-white ring-4 ring-blue-900"
                      : "bg-slate-700 text-slate-500"
                }
              `}
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

// ── Voice Orb ─────────────────────────────────────────────────────────────────
function VoiceOrb({ status, onClick }) {
  const orbConfig = {
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
    error: {
      bg: "bg-red-600",
      ring: "ring-4 ring-red-900",
      icon: "❌",
      pulse: false,
    },
  };
  const cfg = orbConfig[status] || orbConfig.idle;

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={onClick}
        className={`
          w-32 h-32 rounded-full flex items-center justify-center
          text-5xl shadow-2xl transition-all duration-300
          ${cfg.bg} ${cfg.ring}
          ${cfg.pulse ? "animate-pulse" : ""}
          hover:scale-105 active:scale-95 cursor-pointer
        `}
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
                ? "Echo speaking"
                : status === "thinking"
                  ? "Analyzing..."
                  : status === "error"
                    ? "Error — tap to retry"
                    : ""}
      </span>
    </div>
  );
}

// ── Transcript Bubble ─────────────────────────────────────────────────────────
function TranscriptBubble({ role, text }) {
  const isUser = role === "USER";
  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <span className="text-lg shrink-0 mt-1">{isUser ? "👤" : "⚖️"}</span>
      <div
        className={`
        px-4 py-2.5 rounded-2xl text-sm leading-relaxed max-w-xs
        ${
          isUser
            ? "bg-blue-600 text-white rounded-tr-sm"
            : "bg-slate-700 text-slate-100 rounded-tl-sm"
        }
      `}
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
  const [phase, setPhase] = useState("idle"); // idle|form|running|done|failed
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

      // Stream live steps via SSE
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
  const [progressStep, setProgressStep] = useState("intake");
  const [errorMsg, setErrorMsg] = useState("");
  const [activeTab, setActiveTab] = useState("voice"); // voice | docs | file

  const [userId] = useState(() => `user_${Date.now()}`);
  const [sessionId] = useState(() => `session_${Date.now()}`);

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const processorRef = useRef(null);
  const nextPlayTime = useRef(0);

  // ── Play Echo's audio response ─────────────────────────────────────────────
  const playChunk = useCallback((b64) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const float = b64ToFloat32(b64);
    const buf = ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    buf.getChannelData(0).set(float);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, nextPlayTime.current);
    src.start(start);
    nextPlayTime.current = start + buf.duration;
  }, []);

  // ── Send transcript to agents pipeline ────────────────────────────────────
  const sendToAgents = useCallback(
    async (text) => {
      setVoiceStatus("thinking");
      setProgressStep("analyze");
      try {
        const res = await fetch("http://localhost:8000/agents/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, message: text }),
        });
        const data = await res.json();
        setAgentResult(data);
        if (data.classification?.urgency) {
          setProgressStep(
            data.document
              ? "draft"
              : data.classification?.urgency === "CRITICAL"
                ? "draft"
                : "analyze",
          );
        }
        // Add agent response to transcript
        if (data.response_text) {
          setTranscript((prev) => [
            ...prev,
            { role: "ASSISTANT", text: data.response_text },
          ]);
        }
      } catch (e) {
        console.error("Agent error:", e);
      } finally {
        setVoiceStatus("listening");
      }
    },
    [sessionId],
  );

  // ── Start voice session ────────────────────────────────────────────────────
  const startSession = useCallback(async () => {
    setVoiceStatus("connecting");
    setTranscript([]);
    setAgentResult(null);
    setProgressStep("intake");
    setErrorMsg("");

    audioCtxRef.current = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    nextPlayTime.current = 0;

    const ws = new WebSocket("ws://localhost:8000/ws/voice");
    wsRef.current = ws;

    ws.onopen = () => ws.send(JSON.stringify({ type: "start" }));

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "ready") {
        setVoiceStatus("listening");
        await startMicCapture(ws);
      } else if (msg.type === "audio") {
        setVoiceStatus("speaking");
        playChunk(msg.data);
        setTimeout(
          () => setVoiceStatus((s) => (s === "speaking" ? "listening" : s)),
          800,
        );
      } else if (msg.type === "transcript") {
        const newEntry = { role: msg.role, text: msg.text };
        setTranscript((prev) => [...prev, newEntry]);
        // Send user speech to agents pipeline
        if (msg.role === "USER" && msg.text.length > 10) {
          sendToAgents(msg.text);
        }
        if (msg.role === "ASSISTANT") setProgressStep("analyze");
      } else if (msg.type === "error") {
        setErrorMsg(msg.message);
        setVoiceStatus("error");
      }
    };

    ws.onerror = () => {
      setVoiceStatus("error");
      setErrorMsg(
        "Could not connect to backend. Is the server running on port 8000?",
      );
    };
    ws.onclose = () => {
      if (voiceStatus !== "idle") setVoiceStatus("idle");
    };
  }, [playChunk, sendToAgents]);

  // ── Mic capture ────────────────────────────────────────────────────────────
  const startMicCapture = async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;
    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const resampled = downsample(raw, ctx.sampleRate, INPUT_SAMPLE_RATE);
      ws.send(JSON.stringify({ type: "audio", data: float32ToB64(resampled) }));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
  };

  // ── Stop session ───────────────────────────────────────────────────────────
  const stopSession = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
    wsRef.current?.close();
    wsRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setVoiceStatus("idle");
    setProgressStep("intake");
  }, []);

  useEffect(() => () => stopSession(), []);

  const isActive = !["idle", "error"].includes(voiceStatus);

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
                    : voiceStatus === "error"
                      ? "bg-red-900 text-red-300"
                      : "bg-slate-700 text-slate-400"
            }`}
          >
            {voiceStatus.toUpperCase()}
          </span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto flex flex-col items-center px-4 py-6 gap-6">
        {/* ── Progress Bar ── */}
        <ProgressBar currentStep={progressStep} />

        {/* ── Voice Orb ── */}
        <VoiceOrb
          status={voiceStatus}
          onClick={isActive ? stopSession : startSession}
        />

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
          </div>
        )}

        {/* ── Tabs: Voice | Documents | Filing ── */}
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

            {/* Conversation Tab */}
            {activeTab === "voice" && (
              <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
                {transcript.length === 0 ? (
                  <p className="text-center text-slate-500 text-sm py-8">
                    Start speaking — Echo is listening...
                  </p>
                ) : (
                  transcript.map((t, i) => (
                    <TranscriptBubble key={i} role={t.role} text={t.text} />
                  ))
                )}
                {/* Agent Analysis Card */}
                {agentResult?.classification?.category && (
                  <div className="bg-slate-800 rounded-xl p-3 border border-slate-700 mt-2">
                    <p className="text-xs font-semibold text-slate-400 mb-2">
                      🧠 Echo's Analysis
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-lg">
                        {agentResult.classification.category}
                      </span>
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
                    </div>
                    {agentResult.classification.summary && (
                      <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                        {agentResult.classification.summary}
                      </p>
                    )}
                    {agentResult.document && (
                      <div className="mt-2 pt-2 border-t border-slate-700">
                        <p className="text-xs text-green-400">
                          ✍️ Legal letter drafted — switch to File tab to submit
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Documents Tab */}
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

            {/* Filing Tab */}
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
        Echo · Amazon Nova 2 Sonic · Nova Lite · Titan Embeddings · Nova Act
        &nbsp;·&nbsp; ⚖️ Always consult a licensed attorney for final decisions
      </footer>
    </div>
  );
}
