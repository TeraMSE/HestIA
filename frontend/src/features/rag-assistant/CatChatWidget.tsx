/**
 * CatChatWidget – floating cat-icon RAG assistant overlay.
 * Positioned bottom-left on top of the map.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ragApi, type RagChatResponse } from "@/services/ragApi";
import { X, Send, ChevronDown, Sparkles, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: { source_file: string; score: number }[];
  suggested?: string;
}

/* ─── Cat SVG icon ──────────────────────────────────────────────────────── */
function CatIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="HestIA cat assistant"
    >
      {/* Body */}
      <ellipse cx="32" cy="38" rx="18" ry="14" fill="currentColor" opacity="0.9" />
      {/* Head */}
      <circle cx="32" cy="22" r="14" fill="currentColor" />
      {/* Ears */}
      <polygon points="20,12 14,2 25,10" fill="currentColor" />
      <polygon points="44,12 50,2 39,10" fill="currentColor" />
      {/* Ear inner */}
      <polygon points="20,11 16,4 24,10" fill="hsl(var(--background))" opacity="0.6" />
      <polygon points="44,11 48,4 40,10" fill="hsl(var(--background))" opacity="0.6" />
      {/* Eyes */}
      <ellipse cx="26" cy="21" rx="3" ry="3.5" fill="hsl(var(--background))" />
      <ellipse cx="38" cy="21" rx="3" ry="3.5" fill="hsl(var(--background))" />
      <ellipse cx="26" cy="21.5" rx="1.5" ry="2.5" fill="#1a1a2e" />
      <ellipse cx="38" cy="21.5" rx="1.5" ry="2.5" fill="#1a1a2e" />
      {/* Nose */}
      <ellipse cx="32" cy="26" rx="2" ry="1.2" fill="hsl(345 80% 70%)" />
      {/* Whiskers */}
      <line x1="12" y1="25" x2="24" y2="26" stroke="hsl(var(--background))" strokeWidth="1" opacity="0.7" />
      <line x1="12" y1="28" x2="24" y2="27" stroke="hsl(var(--background))" strokeWidth="1" opacity="0.7" />
      <line x1="40" y1="26" x2="52" y2="25" stroke="hsl(var(--background))" strokeWidth="1" opacity="0.7" />
      <line x1="40" y1="27" x2="52" y2="28" stroke="hsl(var(--background))" strokeWidth="1" opacity="0.7" />
      {/* Tail */}
      <path
        d="M50 42 Q60 36 58 28 Q56 22 52 24"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* ─── Source badge ──────────────────────────────────────────────────────── */
function SourceBadge({ source_file, score }: { source_file: string; score: number }) {
  const name = source_file.replace(/^.*[\\/]/, "").replace(/\.pdf$/i, "");
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
      style={{
        borderColor: "hsl(185 95% 55% / 0.3)",
        color: "hsl(185 95% 65%)",
        background: "hsl(185 95% 55% / 0.08)",
      }}
    >
      <FileText className="h-2.5 w-2.5" />
      {name} · {Math.round(score * 100)}%
    </span>
  );
}

/* ─── Main component ────────────────────────────────────────────────────── */
export function CatChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "Meow 🐱 I'm HestIA, your Tunisian real estate assistant. Ask me anything about administrative procedures, contracts, or regulations!",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const sendMessage = useCallback(async (text?: string) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setLoading(true);

    try {
      const res: RagChatResponse = await ragApi.chat(question);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          sources: res.sources.slice(0, 3),
          suggested: res.suggested_question || undefined,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry, an error occurred. Please try again in a moment." },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* ── Floating cat button ──────────────────────────────────────────── */}
      <div
        className="fixed bottom-6 left-6 z-[700] pointer-events-auto"
        id="cat-chat-widget"
      >
        {/* Pulse ring */}
        {!open && (
          <span
            className="absolute inset-0 rounded-full animate-ping"
            style={{ background: "hsl(185 95% 55% / 0.25)" }}
          />
        )}

        <button
          id="cat-chat-toggle-btn"
          onClick={() => setOpen((v) => !v)}
          className="relative flex items-center justify-center w-14 h-14 rounded-full transition-all duration-300 hover:scale-110 active:scale-95 focus:outline-none shadow-2xl"
          style={{
            background: "linear-gradient(135deg, hsl(185 95% 25%), hsl(260 80% 35%))",
            border: "2px solid hsl(185 95% 55% / 0.5)",
            boxShadow: "0 0 24px hsl(185 95% 55% / 0.35)",
          }}
          aria-label={open ? "Close the assistant" : "Open HestIA assistant"}
        >
          <CatIcon className="w-8 h-8 text-[hsl(185,95%,75%)]" />
        </button>
      </div>

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-24 left-6 z-[700] pointer-events-auto transition-all duration-300 origin-bottom-left"
        style={{
          width: "22rem",
          maxHeight: "70vh",
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.85) translateY(16px)",
          pointerEvents: open ? "auto" : "none",
        }}
        id="cat-chat-panel"
      >
        <div
          className="flex flex-col rounded-3xl overflow-hidden"
          style={{
            background: "hsl(220 25% 8% / 0.97)",
            border: "1px solid hsl(185 95% 55% / 0.25)",
            boxShadow: "0 24px 64px hsl(0 0% 0% / 0.6), 0 0 40px hsl(185 95% 55% / 0.1)",
            backdropFilter: "blur(20px)",
            maxHeight: "70vh",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4 py-3 shrink-0"
            style={{
              background: "linear-gradient(90deg, hsl(185 95% 20% / 0.4), hsl(260 80% 20% / 0.3))",
              borderBottom: "1px solid hsl(185 95% 55% / 0.15)",
            }}
          >
            <CatIcon className="w-7 h-7 text-[hsl(185,95%,65%)]" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">HestIA Assistant</p>
              <p className="text-xs text-[hsl(185,95%,65%)]">Tunisian Real Estate · RAG</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0" style={{ maxHeight: "calc(70vh - 130px)" }}>
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[85%] space-y-1.5"
                  style={
                    msg.role === "user"
                      ? {
                          background: "linear-gradient(135deg, hsl(185 95% 25% / 0.7), hsl(260 80% 30% / 0.6))",
                          border: "1px solid hsl(185 95% 55% / 0.3)",
                          borderRadius: "18px 18px 4px 18px",
                          padding: "8px 12px",
                          color: "white",
                          fontSize: "13px",
                        }
                      : {
                          background: "hsl(220 20% 14%)",
                          border: "1px solid hsl(220 20% 22%)",
                          borderRadius: "4px 18px 18px 18px",
                          padding: "8px 12px",
                          color: "hsl(220 10% 85%)",
                          fontSize: "13px",
                        }
                  }
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>

                  {/* Sources */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {msg.sources.map((s, si) => (
                        <SourceBadge key={si} {...s} />
                      ))}
                    </div>
                  )}

                  {/* Suggested follow-up */}
                  {msg.suggested && (
                    <button
                      onClick={() => sendMessage(msg.suggested)}
                      className="flex items-center gap-1 text-[11px] mt-1.5 text-left transition-colors hover:opacity-80"
                      style={{ color: "hsl(185 95% 60%)" }}
                    >
                      <Sparkles className="h-3 w-3 shrink-0" />
                      <span className="underline underline-offset-2">{msg.suggested}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-1.5 px-3 py-2 rounded-2xl"
                  style={{ background: "hsl(220 20% 14%)", border: "1px solid hsl(220 20% 22%)" }}
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-1.5 h-1.5 rounded-full animate-bounce"
                      style={{
                        background: "hsl(185 95% 55%)",
                        animationDelay: `${i * 0.15}s`,
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div
            className="px-3 py-2.5 shrink-0"
            style={{ borderTop: "1px solid hsl(220 20% 18%)" }}
          >
            <div
              className="flex items-center gap-2 rounded-2xl px-3 py-1.5"
              style={{
                background: "hsl(220 20% 12%)",
                border: "1px solid hsl(185 95% 55% / 0.2)",
              }}
            >
              <input
                ref={inputRef}
                id="cat-chat-input"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask your question..."
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-white placeholder:text-muted-foreground outline-none min-w-0"
              />
              <button
                id="cat-chat-send-btn"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
                style={{
                  background: "linear-gradient(135deg, hsl(185 95% 40%), hsl(260 80% 50%))",
                }}
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5 text-white" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-1.5">
              Sources: Tunisian real estate regulations
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
