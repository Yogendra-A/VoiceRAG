import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Upload, FileText, Zap, ChevronDown, ChevronUp, Wifi, WifiOff, Send, Volume2, RotateCcw } from "lucide-react";

const API = "http://localhost:8000";

// ─── Helpers ────────────────────────────────────────────────────────────────

function confidenceLabel(score) {
  if (score >= 0.7) return { label: "High", color: "text-emerald-400", bg: "bg-emerald-400/10 border-emerald-400/30" };
  if (score >= 0.45) return { label: "Medium", color: "text-amber-400", bg: "bg-amber-400/10 border-amber-400/30" };
  return { label: "Low", color: "text-rose-400", bg: "bg-rose-400/10 border-rose-400/30" };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function BackendBanner({ connected }) {
  return (
    <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-medium transition-all ${connected ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-rose-500/10 border-rose-500/30 text-rose-400"}`}>
      {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
      {connected ? "Backend connected" : "Backend not connected — start the FastAPI server"}
    </div>
  );
}

function UploadPanel({ onUploaded }) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fileInfo, setFileInfo] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  async function processFile(file) {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf", "txt"].includes(ext)) { setError("Only PDF and TXT files supported."); return; }
    setError("");
    setLoading(true);
    setFileInfo({ name: file.name, status: "indexing" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API}/upload`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setFileInfo({ name: file.name, chunks: data.chunks, status: "ready" });
      onUploaded(file.name);
    } catch (e) {
      setError(e.message);
      setFileInfo(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={18} className="text-violet-400" />
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-widest">Knowledge Base</h2>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files[0]); }}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-all duration-300 ${dragging ? "border-violet-500 bg-violet-500/10" : "border-slate-600 hover:border-violet-500/60 hover:bg-violet-500/5"}`}
      >
        <input ref={inputRef} type="file" accept=".pdf,.txt" className="hidden" onChange={(e) => processFile(e.target.files[0])} />
        {loading ? (
          <>
            <div className="w-10 h-10 rounded-full border-2 border-violet-500 border-t-transparent animate-spin" />
            <p className="text-slate-400 text-sm">Indexing document…</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Upload size={22} className="text-violet-400" />
            </div>
            <div className="text-center">
              <p className="text-slate-300 text-sm font-medium">Drop PDF or TXT here</p>
              <p className="text-slate-500 text-xs mt-1">or click to browse</p>
            </div>
          </>
        )}
      </div>

      {fileInfo && !loading && (
        <div className="mt-3 flex items-center justify-between px-4 py-2.5 bg-slate-700/50 rounded-xl border border-slate-600/50">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={14} className="text-slate-400 shrink-0" />
            <span className="text-slate-300 text-sm truncate">{fileInfo.name}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            {fileInfo.chunks && <span className="text-slate-500 text-xs">{fileInfo.chunks} chunks</span>}
            {fileInfo.status === "ready" && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Ready
              </span>
            )}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function MicButton({ onTranscribed }) {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRef.current = mr;
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(250);
      setRecording(true);
    } catch (e) {
      setError("Microphone access denied.");
    }
  }

  async function stopRecording() {
    if (!mediaRef.current) return;
    setRecording(false);
    setLoading(true);
    mediaRef.current.stop();
    mediaRef.current.stream.getTracks().forEach((t) => t.stop());

    // wait for onstop
    await new Promise((resolve) => { mediaRef.current.onstop = resolve; });

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    const fd = new FormData();
    fd.append("audio", blob, "recording.webm");

    try {
      const res = await fetch(`${API}/transcribe`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Transcription failed");
      onTranscribed(data.transcript);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        {recording && (
          <>
            <span className="absolute inset-0 rounded-full bg-rose-500/30 animate-ping" />
            <span className="absolute inset-[-8px] rounded-full bg-rose-500/15 animate-pulse" />
          </>
        )}
        <button
          id="mic-button"
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
          onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
          disabled={loading}
          className={`relative w-24 h-24 rounded-full flex items-center justify-center shadow-2xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
            recording
              ? "bg-gradient-to-br from-rose-500 to-rose-600 scale-110 shadow-rose-500/40"
              : loading
              ? "bg-slate-700 cursor-not-allowed"
              : "bg-gradient-to-br from-violet-500 to-violet-700 hover:scale-105 shadow-violet-500/30"
          }`}
        >
          {loading ? (
            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : recording ? (
            <MicOff size={32} className="text-white" />
          ) : (
            <Mic size={32} className="text-white" />
          )}
        </button>
      </div>
      <p className="text-slate-400 text-sm">
        {loading ? "Transcribing…" : recording ? "Release to stop" : "Hold to record"}
      </p>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function SourceChunks({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;
  const topScore = Math.max(...sources.map((s) => s.score));
  const conf = confidenceLabel(topScore);

  return (
    <div className="mt-3 border border-slate-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Zap size={13} className={conf.color} />
          <span className="text-xs text-slate-400">Sources</span>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${conf.bg} ${conf.color}`}>
            {conf.label} Confidence
          </span>
        </div>
        {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </button>
      {open && (
        <div className="divide-y divide-slate-700/40">
          {sources.map((s, i) => (
            <div key={i} className="px-4 py-3 bg-slate-900/60">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-500 font-medium">Source {i + 1}</span>
                <span className={`text-xs font-semibold ${confidenceLabel(s.score).color}`}>
                  {(s.score * 100).toFixed(0)}% match
                </span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed line-clamp-4">{s.chunk}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ turn }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-violet-600/30 border border-violet-500/30 text-slate-200 text-sm leading-relaxed">
          {turn.question}
        </div>
      </div>
      <div className="flex justify-start">
        <div className="max-w-[90%]">
          <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-slate-800/80 border border-slate-700/50 text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
            {turn.answer}
          </div>
          <SourceChunks sources={turn.sources} />
        </div>
      </div>
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────

export default function App() {
  const [backendOk, setBackendOk] = useState(null);
  const [kbReady, setKbReady] = useState(false);
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState([]); // [{question, answer, sources}]
  const [streaming, setStreaming] = useState(false);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [currentSources, setCurrentSources] = useState([]);
  const historyEndRef = useRef(null);

  // Poll health
  useEffect(() => {
    async function checkHealth() {
      try {
        const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(3000) });
        setBackendOk(res.ok);
      } catch {
        setBackendOk(false);
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, currentAnswer]);

  const handleTranscribed = useCallback((text) => {
    setQuestion(text);
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault();
    const q = question.trim();
    if (!q || streaming) return;

    setStreaming(true);
    setCurrentAnswer("");
    setCurrentSources([]);

    // Build chat_history payload
    const chatHistoryPayload = history.slice(-4).flatMap((h) => [
      { role: "user", content: h.question },
      { role: "assistant", content: h.answer },
    ]);

    try {
      const res = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, chat_history: chatHistoryPayload }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Query failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answerAccum = "";
      let sourcesAccum = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const msg = JSON.parse(raw);
            if (msg.type === "sources") {
              sourcesAccum = msg.sources;
              setCurrentSources(msg.sources);
            } else if (msg.type === "token") {
              answerAccum += msg.content;
              setCurrentAnswer((prev) => prev + msg.content);
            } else if (msg.type === "fallback") {
              answerAccum = msg.content;
              setCurrentAnswer(msg.content);
            } else if (msg.type === "error") {
              answerAccum = `⚠️ Error: ${msg.content}`;
              setCurrentAnswer(answerAccum);
            }
          } catch {}
        }
      }

      setHistory((prev) => [
        ...prev,
        { question: q, answer: answerAccum, sources: sourcesAccum },
      ].slice(-5));
      setCurrentAnswer("");
      setCurrentSources([]);
      setQuestion("");
    } catch (e) {
      setCurrentAnswer(`⚠️ ${e.message}`);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0d14] text-white font-sans">
      {/* ── Header ── */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Volume2 size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight bg-gradient-to-r from-violet-300 to-fuchsia-400 bg-clip-text text-transparent">
                VoiceRAG
              </h1>
              <p className="text-xs text-slate-500 -mt-0.5">Voice-driven RAG assistant</p>
            </div>
          </div>
          {backendOk !== null && <BackendBanner connected={backendOk} />}
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* ── Upload Panel ── */}
        <UploadPanel onUploaded={() => setKbReady(true)} />

        {/* ── Chat History ── */}
        {history.length > 0 && (
          <div className="space-y-5 max-h-[42vh] overflow-y-auto pr-1 custom-scrollbar">
            {history.map((turn, i) => (
              <ChatBubble key={i} turn={turn} />
            ))}
            {/* Streaming bubble */}
            {streaming && currentAnswer && (
              <div className="space-y-2">
                <div className="flex justify-end">
                  <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-violet-600/30 border border-violet-500/30 text-slate-200 text-sm leading-relaxed">
                    {question}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="max-w-[90%]">
                    <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-slate-800/80 border border-slate-700/50 text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                      {currentAnswer}
                      <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-bottom rounded-sm" />
                    </div>
                    <SourceChunks sources={currentSources} />
                  </div>
                </div>
              </div>
            )}
            <div ref={historyEndRef} />
          </div>
        )}

        {/* Streaming (first message) */}
        {streaming && currentAnswer && history.length === 0 && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-tr-sm bg-violet-600/30 border border-violet-500/30 text-slate-200 text-sm leading-relaxed">
                {question}
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[90%]">
                <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-slate-800/80 border border-slate-700/50 text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">
                  {currentAnswer}
                  <span className="inline-block w-1.5 h-4 bg-violet-400 animate-pulse ml-0.5 align-bottom rounded-sm" />
                </div>
                <SourceChunks sources={currentSources} />
              </div>
            </div>
          </div>
        )}

        {/* ── Input Area ── */}
        <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-2xl p-6 space-y-5">
          {/* Mic */}
          <div className="flex flex-col items-center">
            <MicButton onTranscribed={handleTranscribed} />
          </div>

          {/* Text input + send */}
          <form onSubmit={handleSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <textarea
                id="question-input"
                rows={2}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder={kbReady ? "Ask a question (or use the mic)…" : "Upload a document first…"}
                disabled={!kbReady || streaming}
                className="w-full bg-slate-900/80 border border-slate-600/60 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:border-violet-500/70 focus:ring-1 focus:ring-violet-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                id="submit-btn"
                type="submit"
                disabled={!question.trim() || !kbReady || streaming}
                className="px-4 py-2.5 bg-gradient-to-br from-violet-500 to-violet-700 rounded-xl text-white text-sm font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:from-violet-400 hover:to-violet-600 transition-all shadow-lg shadow-violet-500/20 h-full"
              >
                {streaming ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send size={15} />
                )}
                Ask
              </button>
            </div>
          </form>
          {!kbReady && (
            <p className="text-xs text-slate-500 text-center">⬆ Upload a PDF or TXT document to enable the assistant</p>
          )}
        </div>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 9999px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}</style>
    </div>
  );
}
