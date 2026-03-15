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

// ── LegalDocumentCard ─────────────────────────────────────────────────────────
// Renders the drafted legal document with proper formatting and a copy button.
// Handles: **bold**, newlines, "- " bullet lists, numbered lists, blank lines.
function LegalDocumentCard({ document: docText }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (!docText) return null;

  // Copy plain text to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(docText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback for browsers that block clipboard API
      const el = document.createElement("textarea");
      el.value = docText;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  // Parse the raw text into renderable segments
  const renderDocumentText = (raw) => {
    const lines = raw.split("\n");
    const elements = [];
    let key = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Blank line → spacer
      if (line.trim() === "") {
        elements.push(<div key={key++} className="h-2" />);
        continue;
      }

      // Numbered list item  e.g. "1. PARTIES: ..."
      const numberedMatch = line.match(/^(\d+)\.\s+(.*)$/);
      if (numberedMatch) {
        elements.push(
          <div key={key++} className="flex gap-2 text-xs leading-relaxed">
            <span className="text-slate-400 shrink-0 font-semibold w-5 text-right">
              {numberedMatch[1]}.
            </span>
            <span className="text-slate-200">
              {renderInline(numberedMatch[2])}
            </span>
          </div>,
        );
        continue;
      }

      // Bullet item  e.g. "- Date: ..."  or "* Note:"
      const bulletMatch = line.match(/^[-*]\s+(.*)$/);
      if (bulletMatch) {
        elements.push(
          <div key={key++} className="flex gap-2 text-xs leading-relaxed">
            <span className="text-blue-400 shrink-0 mt-0.5">•</span>
            <span className="text-slate-200">
              {renderInline(bulletMatch[1])}
            </span>
          </div>,
        );
        continue;
      }

      // Section header heuristic: ALL CAPS line or ends with ":"
      const isHeader =
        (line === line.toUpperCase() &&
          line.trim().length > 3 &&
          !/[a-z]/.test(line)) ||
        /^(Re:|Dear |Sincerely|Regards|Subject:|To:|From:|Date:)/i.test(
          line.trim(),
        );

      if (isHeader) {
        elements.push(
          <p key={key++} className="text-xs font-bold text-slate-100 mt-1">
            {renderInline(line)}
          </p>,
        );
        continue;
      }

      // Normal paragraph line
      elements.push(
        <p key={key++} className="text-xs text-slate-300 leading-relaxed">
          {renderInline(line)}
        </p>,
      );
    }

    return elements;
  };

  // Render inline markdown: **bold** and _italic_
  const renderInline = (text) => {
    const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-semibold text-slate-100">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("_") && part.endsWith("_")) {
        return (
          <em key={i} className="italic text-slate-300">
            {part.slice(1, -1)}
          </em>
        );
      }
      return part;
    });
  };

  return (
    <div className="mt-2 rounded-xl border border-emerald-800 bg-slate-900 overflow-hidden">
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-2
                      bg-emerald-950 border-b border-emerald-800"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">✍️</span>
          <span className="text-xs font-semibold text-emerald-400">
            Legal Document Drafted
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            title="Copy document text"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs
              font-medium transition-all duration-200
              ${
                copied
                  ? "bg-green-700 text-green-200"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white"
              }`}
          >
            {copied ? "✅ Copied!" : "📋 Copy"}
          </button>
          {/* Collapse / expand toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? "Expand" : "Collapse"}
            className="px-2 py-1 rounded-lg text-xs text-slate-400
              hover:bg-slate-700 hover:text-white transition-colors"
          >
            {collapsed ? "▼ Show" : "▲ Hide"}
          </button>
        </div>
      </div>

      {/* Document body */}
      {!collapsed && (
        <div
          className="px-4 py-3 max-h-72 overflow-y-auto
                        font-mono text-left space-y-0.5
                        border-l-2 border-emerald-900"
        >
          {renderDocumentText(docText)}
        </div>
      )}

      {/* Disclaimer footer */}
      {!collapsed && (
        <div className="px-3 py-2 bg-slate-800 border-t border-slate-700">
          <p className="text-xs text-slate-500">
            ⚖️ This draft is for reference only. Have a licensed attorney review
            before sending.
          </p>
        </div>
      )}
    </div>
  );
}

// DocumentPanel with persistent docs + view/download ─────────
function DocumentPanel({ userId, sessionId, onAnalysis }) {
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [expanded, setExpanded] = useState(null); // doc_id of expanded card

  // Keep original File objects in a ref so view/download work without re-upload
  const fileMapRef = useRef({});

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
        fileMapRef.current[data.doc_id] = file; // store for later view/download
        setDocuments((d) => [...d, data]);
        onAnalysis(data);
      } else {
        alert(`Upload failed: ${data.detail}`);
      }
    } catch (e) {
      alert(`Upload error: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleView = (doc) => {
    const file = fileMapRef.current[doc.doc_id];
    if (!file) {
      alert("File not available — please re-upload to view.");
      return;
    }
    const url = URL.createObjectURL(file);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  };

  const handleDownload = (doc) => {
    const file = fileMapRef.current[doc.doc_id];
    if (!file) {
      alert("File not available — please re-upload to download.");
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const typeColor = (t) =>
    ({
      EVICTION_NOTICE: "bg-red-900 text-red-300",
      LEASE_AGREEMENT: "bg-blue-900 text-blue-300",
      DEMAND_LETTER: "bg-orange-900 text-orange-300",
      COURT_NOTICE: "bg-purple-900 text-purple-300",
      PAY_STUB: "bg-green-900 text-green-300",
      TERMINATION_LETTER: "bg-red-900 text-red-300",
    })[t] || "bg-slate-700 text-slate-300";

  return (
    <div className="w-full flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
        📎 Upload Documents
      </h3>

      {/* Drop zone */}
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
        <span className="text-xs text-slate-600 mt-0.5">
          PDF · JPEG · PNG · WebP — max 10 MB
        </span>
      </label>

      {/* Uploaded docs list — persists across tab switches */}
      {documents.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-500">
            {documents.length} document{documents.length !== 1 ? "s" : ""}{" "}
            uploaded this session
          </p>

          {documents.map((doc) => (
            <div
              key={doc.doc_id}
              className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden"
            >
              {/* Title row */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="text-base shrink-0">
                  {doc.doc_type === "IMAGE" ? "🖼️" : "📄"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-200 truncate">
                    {doc.filename}
                  </p>
                  <p className="text-xs text-slate-500">
                    {doc.chunks_indexed} chunk
                    {doc.chunks_indexed !== 1 ? "s" : ""} indexed
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full shrink-0 font-medium ${typeColor(doc.doc_type)}`}
                >
                  {doc.doc_type.replace(/_/g, " ")}
                </span>
              </div>

              {/* Summary */}
              {doc.analysis?.summary && (
                <div className="px-3 pb-2">
                  <p
                    className={`text-xs text-slate-400 leading-relaxed
                    ${expanded === doc.doc_id ? "" : "line-clamp-2"}`}
                  >
                    {doc.analysis.summary}
                  </p>
                  {doc.analysis.summary.length > 100 && (
                    <button
                      onClick={() =>
                        setExpanded(expanded === doc.doc_id ? null : doc.doc_id)
                      }
                      className="text-xs text-blue-400 hover:text-blue-300 mt-0.5 transition-colors"
                    >
                      {expanded === doc.doc_id ? "Show less ▲" : "Show more ▼"}
                    </button>
                  )}
                </div>
              )}

              {/* Urgency flags */}
              {doc.analysis?.urgency_flags?.length > 0 && (
                <div className="flex flex-wrap gap-1 px-3 pb-2">
                  {doc.analysis.urgency_flags.map((f, i) => (
                    <span
                      key={i}
                      className="text-xs bg-red-950 border border-red-800
                      text-red-300 px-1.5 py-0.5 rounded"
                    >
                      ⚠️ {f}
                    </span>
                  ))}
                </div>
              )}

              {/* Expanded details */}
              {expanded === doc.doc_id && (
                <>
                  {doc.analysis?.key_dates?.length > 0 && (
                    <div className="px-3 pb-2 border-t border-slate-700 pt-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">
                        Key Dates
                      </p>
                      {doc.analysis.key_dates.map((d, i) => (
                        <p key={i} className="text-xs text-slate-400">
                          📅 {d}
                        </p>
                      ))}
                    </div>
                  )}
                  {doc.analysis?.key_amounts?.length > 0 && (
                    <div className="px-3 pb-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">
                        Key Amounts
                      </p>
                      {doc.analysis.key_amounts.map((a, i) => (
                        <p key={i} className="text-xs text-slate-400">
                          💰 {a}
                        </p>
                      ))}
                    </div>
                  )}
                  {doc.analysis?.parties?.sender && (
                    <div className="px-3 pb-2">
                      <p className="text-xs font-semibold text-slate-500 mb-1">
                        Parties
                      </p>
                      <p className="text-xs text-slate-400">
                        From: {doc.analysis.parties.sender}
                      </p>
                      <p className="text-xs text-slate-400">
                        To: {doc.analysis.parties.recipient}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* View / Download actions */}
              <div className="flex border-t border-slate-700">
                <button
                  onClick={() => handleView(doc)}
                  className="flex-1 py-2 text-xs text-blue-400 hover:bg-slate-700
                    transition-colors flex items-center justify-center gap-1"
                >
                  👁️ View
                </button>
                <div className="w-px bg-slate-700" />
                <button
                  onClick={() => handleDownload(doc)}
                  className="flex-1 py-2 text-xs text-green-400 hover:bg-slate-700
                    transition-colors flex items-center justify-center gap-1"
                >
                  ⬇️ Download
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// FilingPanel with persistent result + "File Another" ────────
function FilingPanel({ sessionId, issueType, issueSummary }) {
  const [phase, setPhase] = useState("idle");
  const [steps, setSteps] = useState([]);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [lastWorkflow, setLastWorkflow] = useState("");
  const [lastResult, setLastResult] = useState(null); // survives tab switches

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    state: "",
    city: "",
  });

  const WORKFLOW_LABELS = {
    legalaid: "LegalAid.org Intake",
    benefits: "USA.gov Benefits Finder",
    aba: "ABA Free Legal Answers",
  };

  const startFiling = async (workflowName) => {
    if (!form.firstName || !form.email || !form.state) {
      alert("First Name, Email, and State are required.");
      return;
    }
    setPhase("running");
    setSteps([]);
    setConfirmation("");
    setError("");
    setLastWorkflow(workflowName);

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

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to start workflow");
      }

      const data = await res.json();
      const jobId = data.job_id;
      if (!jobId) throw new Error("No job ID returned from server");

      const evtSrc = new EventSource(
        `http://localhost:8000/nova-act/stream/${jobId}`,
      );

      evtSrc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "ping") return;

          if (msg.type === "step") {
            setSteps((prev) => {
              const idx = prev.findIndex(
                (s) => s.step_num === msg.step.step_num,
              );
              if (idx >= 0) {
                const u = [...prev];
                u[idx] = msg.step;
                return u;
              }
              return [...prev, msg.step];
            });
          }

          if (msg.type === "complete") {
            const ok = msg.job.status === "done";
            const conf = msg.job.confirmation || "";
            const err = msg.job.error || "";
            setPhase(ok ? "done" : "failed");
            setConfirmation(conf);
            setError(err);
            // Persist last successful result
            if (ok) {
              setLastResult({
                workflow: workflowName,
                label: WORKFLOW_LABELS[workflowName] || workflowName,
                conf,
                filedAt: new Date().toLocaleString(),
                name: `${form.firstName} ${form.lastName}`.trim(),
                email: form.email,
                state: form.state,
              });
            }
            evtSrc.close();
          }
        } catch (parseErr) {
          console.error("SSE parse error:", parseErr);
        }
      };

      evtSrc.onerror = () => {
        setPhase("failed");
        setError("Connection lost during filing. Check backend and try again.");
        evtSrc.close();
      };
    } catch (e) {
      setPhase("failed");
      setError(e.message);
    }
  };

  // ── Idle ──────────────────────────────────────────────────────────────────
  if (phase === "idle")
    return (
      <div className="w-full flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          🤖 Autonomous Filing
        </h3>

        {/* Show last result card if available */}
        {lastResult && (
          <div className="bg-green-950 border border-green-800 rounded-xl p-3">
            <p className="text-xs font-semibold text-green-400 mb-1">
              ✅ Last filing: {lastResult.label}
            </p>
            <p className="text-xs text-green-300">
              Filed for: {lastResult.name} · {lastResult.state}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {lastResult.filedAt}
            </p>
            <button
              onClick={() => setPhase("result")}
              className="text-xs text-blue-400 hover:text-blue-300 mt-1 transition-colors"
            >
              View confirmation →
            </button>
          </div>
        )}

        <button
          onClick={() => setPhase("form")}
          className="w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500
                   text-white font-semibold text-sm transition-colors"
        >
          🤖 {lastResult ? "File Another" : "File with Legal Aid Automatically"}
        </button>
      </div>
    );

  // ── Show previous result ───────────────────────────────────────────────────
  if (phase === "result" && lastResult)
    return (
      <div className="w-full flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          🤖 Filing Confirmation
        </h3>
        <div className="bg-green-950 border border-green-700 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-400 mb-2">
            ✅ {lastResult.label}
          </p>
          <p className="text-xs text-green-300 leading-relaxed whitespace-pre-line">
            {lastResult.conf}
          </p>
        </div>
        <button
          onClick={() => setPhase("idle")}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          ← Back
        </button>
      </div>
    );

  // ── Form ──────────────────────────────────────────────────────────────────
  if (phase === "form")
    return (
      <div className="w-full flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          🤖 Your Details
        </h3>

        {issueType && issueType !== "OTHER" && (
          <div className="bg-slate-800 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-xs text-slate-400">Issue detected:</span>
            <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded-full">
              {issueType.replace(/_/g, " ")}
            </span>
          </div>
        )}

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
                       placeholder-slate-500 outline-none focus:ring-1
                       focus:ring-blue-500 transition-all"
            />
          ))}

          <div className="flex gap-2 pt-1">
            <button
              onClick={() => startFiling("legalaid")}
              className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500
                       text-white text-xs font-semibold transition-colors"
            >
              📋 LegalAid
            </button>
            <button
              onClick={() => startFiling("benefits")}
              className="flex-1 py-2.5 rounded-lg bg-green-700 hover:bg-green-600
                       text-white text-xs font-semibold transition-colors"
            >
              🏛️ Benefits
            </button>
            <button
              onClick={() => startFiling("aba")}
              className="flex-1 py-2.5 rounded-lg bg-purple-700 hover:bg-purple-600
                       text-white text-xs font-semibold transition-colors"
            >
              ⚖️ ABA
            </button>
          </div>

          <button
            onClick={() => setPhase("idle")}
            className="text-xs text-slate-500 hover:text-slate-300 mt-1 transition-colors"
          >
            ← Cancel
          </button>
        </div>
      </div>
    );

  // ── Running / Done / Failed ───────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
          🤖 {WORKFLOW_LABELS[lastWorkflow] || "Filing Progress"}
        </h3>
        <span
          className={`text-xs font-medium
          ${
            phase === "running"
              ? "text-blue-400 animate-pulse"
              : phase === "done"
                ? "text-green-400"
                : "text-red-400"
          }`}
        >
          {phase === "running"
            ? "In progress..."
            : phase === "done"
              ? "✅ Complete"
              : "❌ Failed"}
        </span>
      </div>

      {/* Steps */}
      {steps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {steps.map((step, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg px-3 py-2
                ${
                  step.status === "running"
                    ? "bg-blue-950 border border-blue-800"
                    : step.status === "done"
                      ? "bg-slate-800"
                      : "bg-red-950 border border-red-800"
                }`}
            >
              <span className="text-sm shrink-0 mt-0.5">
                {step.status === "running"
                  ? "⏳"
                  : step.status === "done"
                    ? "✅"
                    : "❌"}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-slate-300">{step.description}</p>
                {step.result && step.status === "done" && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                    {step.result.slice(0, 90)}
                  </p>
                )}
                {step.result && step.status === "failed" && (
                  <p className="text-xs text-red-400 mt-0.5">
                    {step.result.slice(0, 120)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation */}
      {phase === "done" && confirmation && (
        <div className="bg-green-950 border border-green-700 rounded-xl p-4">
          <p className="text-xs font-semibold text-green-400 mb-2">
            🎉 Filing Confirmed
          </p>
          <p className="text-xs text-green-300 leading-relaxed whitespace-pre-line">
            {confirmation}
          </p>
        </div>
      )}

      {/* Error */}
      {phase === "failed" && error && (
        <div className="bg-red-950 border border-red-700 rounded-xl p-3">
          <p className="text-xs font-semibold text-red-400 mb-1">
            Filing Failed
          </p>
          <p className="text-xs text-red-300">{error}</p>
        </div>
      )}

      {/* Post-completion actions */}
      {(phase === "done" || phase === "failed") && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => setPhase("form")}
            className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500
                       text-white text-xs font-semibold transition-colors"
          >
            🤖 File Another
          </button>
          {phase === "failed" && (
            <button
              onClick={() => startFiling(lastWorkflow)}
              className="flex-1 py-2.5 rounded-xl bg-blue-700 hover:bg-blue-600
                         text-white text-xs font-semibold transition-colors"
            >
              🔄 Retry
            </button>
          )}
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
  const micCtxRef = useRef(null);
  const nextPlayTime = useRef(0);
  const transcriptRef = useRef([]);

  // ── IMPROVEMENT 1 & 2: scroll refs ───────────────────────────────────────
  const transcriptScrollRef = useRef(null); // scrollable container div
  const transcriptBottomRef = useRef(null); // sentinel div at bottom

  // Keep transcriptRef in sync with state for use in callbacks
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  // IMPROVEMENT 1: auto-scroll whenever transcript or analysis changes
  useEffect(() => {
    if (transcriptBottomRef.current) {
      transcriptBottomRef.current.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
    }
  }, [transcript, agentResult, agentLoading]);

  // IMPROVEMENT 2: instant scroll-to-bottom when Conversation tab is activated
  useEffect(() => {
    if (activeTab === "voice" && transcriptScrollRef.current) {
      const timer = setTimeout(() => {
        if (transcriptScrollRef.current) {
          transcriptScrollRef.current.scrollTop =
            transcriptScrollRef.current.scrollHeight;
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [activeTab]);

  // ── Audio playback ────────────────────────────────────────────────────────
  const playChunk = useCallback((b64) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const float32 = b64ToFloat32(b64);
    const buffer = ctx.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime + 0.02, nextPlayTime.current);
    source.start(startAt);
    nextPlayTime.current = startAt + buffer.duration;
  }, []);

  // ── Agent analysis ────────────────────────────────────────────────────────
  const runAgentAnalysis = useCallback(
    async (transcriptToAnalyze) => {
      if (!transcriptToAnalyze?.length) return;
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
        if (data.classification?.urgency === "CRITICAL" || data.document)
          setProgressStep("draft");
        else if (data.classification?.category) setProgressStep("analyze");
        if (data.response_text)
          setTranscript((prev) => [
            ...prev,
            { role: "ASSISTANT", text: data.response_text },
          ]);
      } catch (e) {
        console.error("Agent analysis error:", e);
      } finally {
        setAgentLoading(false);
      }
    },
    [sessionId],
  );

  // ── Stop & Analyze ────────────────────────────────────────────────────────
  const handleStopAndAnalyze = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "pause_mic" }));
    setMicPaused(true);
    setVoiceStatus("paused");
    setActiveTab("voice");
    runAgentAnalysis(transcriptRef.current);
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

    ws.onopen = () => ws.send(JSON.stringify({ type: "start" }));

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case "ready":
          setVoiceStatus("listening");
          await startMicCapture(ws);
          break;
        case "audio":
          setVoiceStatus("speaking");
          playChunk(msg.data);
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
    ws.onclose = () => setVoiceStatus((s) => (s !== "error" ? "idle" : s));
  }, [playChunk, micPaused]);

  const startMicCapture = async (ws) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    const ctx = new AudioContext();
    micCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    processorRef.current = proc;
    proc.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const raw = e.inputBuffer.getChannelData(0);
      const resampled = downsample(raw, ctx.sampleRate, INPUT_SAMPLE_RATE);
      ws.send(JSON.stringify({ type: "audio", data: float32ToB64(resampled) }));
    };
    source.connect(proc);
    proc.connect(ctx.destination);
  };

  const stopSession = useCallback(() => {
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN)
        wsRef.current.send(JSON.stringify({ type: "stop" }));
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
        <ProgressBar currentStep={progressStep} />
        <VoiceOrb
          status={voiceStatus}
          onClick={isActive ? stopSession : startSession}
        />

        {/* ── Stop & Analyze / Resume ── */}
        {isActive && (
          <div className="w-full flex gap-2">
            {!micPaused ? (
              <button
                onClick={handleStopAndAnalyze}
                disabled={!canAnalyze || agentLoading}
                className={`flex-1 py-3 rounded-xl font-semibold text-sm
                  transition-all flex items-center justify-center gap-2
                  ${
                    canAnalyze && !agentLoading
                      ? "bg-purple-700 hover:bg-purple-600 text-white cursor-pointer"
                      : "bg-slate-800 text-slate-500 cursor-not-allowed"
                  }`}
              >
                {agentLoading ? (
                  <>
                    <span className="animate-spin">⏳</span> Analyzing...
                  </>
                ) : (
                  <>
                    <span>🧠</span> Stop & Analyze
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
                <span>🎙️</span> Resume Listening
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

        {/* ── Idle welcome ── */}
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

            {/* ── Conversation ── */}
            {activeTab === "voice" && (
              <div className="flex flex-col gap-3">
                {/* IMPROVEMENT 1 + 2: scroll container with bottom sentinel */}
                <div
                  ref={transcriptScrollRef}
                  className="flex flex-col gap-3 max-h-72 overflow-y-auto pr-1 scroll-smooth"
                >
                  {transcript.length === 0 ? (
                    <p className="text-center text-slate-500 text-sm py-8">
                      Start speaking — Echo is listening...
                    </p>
                  ) : (
                    transcript.map((t, i) => (
                      <TranscriptBubble key={i} role={t.role} text={t.text} />
                    ))
                  )}
                  {/* Sentinel — auto-scroll targets this */}
                  <div ref={transcriptBottomRef} />
                </div>

                {agentLoading && (
                  <div className="bg-slate-800 rounded-xl p-4 border border-purple-800 animate-pulse">
                    <p className="text-xs text-purple-400 flex items-center gap-2">
                      <span className="animate-spin inline-block">⏳</span>
                      Running legal analysis through Nova Lite agents...
                    </p>
                  </div>
                )}

                {agentResult && !agentLoading && (
                  <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
                    <p className="text-xs font-semibold text-slate-400 mb-3">
                      🧠 Echo's Legal Analysis
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {agentResult.classification?.category && (
                        <span className="text-xs bg-blue-900 text-blue-300 px-2 py-1 rounded-lg">
                          {agentResult.classification.category.replace(
                            /_/g,
                            " ",
                          )}
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
                    {agentResult.classification?.summary && (
                      <p className="text-xs text-slate-400 leading-relaxed mb-3">
                        {agentResult.classification.summary}
                      </p>
                    )}
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
                    {agentResult.document && (
                      <div className="pt-3 border-t border-slate-700">
                        <LegalDocumentCard document={agentResult.document} />
                      </div>
                    )}
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

            {/* ── Documents ── */}
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

            {/* ── Filing ── */}
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

      <footer className="py-3 text-center text-xs text-slate-700 border-t border-slate-800">
        Echo · Amazon Nova 2 Sonic · Nova Lite APAC · Titan Embeddings · Nova
        Act &nbsp;·&nbsp; ⚖️ Always consult a licensed attorney for final
        decisions
      </footer>
    </div>
  );
}
