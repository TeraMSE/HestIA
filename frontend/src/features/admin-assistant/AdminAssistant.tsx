import { useState } from "react";
import { OverlayPanel } from "@/shared/ui/OverlayPanel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Send } from "lucide-react";
import { adminService } from "@/services/mockApi";
import type { AdminMessage } from "@/contracts/types";

export function AdminAssistant() {
  const [messages, setMessages] = useState<AdminMessage[]>([
    { id: "m0", role: "assistant", content: "Hi! I can guide you through Tunisian real estate procedures. Try: 'How do I rent in Tunis?', 'How to buy?', 'How to list my property?'" },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg: AdminMessage = { id: `m_${Date.now()}`, role: "user", content: input };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setThinking(true);
    try {
      const r = await adminService.ask(userMsg.content);
      const reply: AdminMessage = { id: `m_${Date.now()}_a`, role: "assistant", content: r.content, cards: r.cards };
      setMessages((m) => [...m, reply]);
    } finally { setThinking(false); }
  };

  return (
    <OverlayPanel title="Admin Assistant" subtitle="Tunisian real estate procedures" size="lg">
      <div className="flex flex-col h-[60vh]">
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] space-y-2 ${m.role === "user" ? "" : ""}`}>
                <div className={`rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.content}
                </div>
                {m.cards?.map((c, i) => (
                  <Card key={i} className="rounded-2xl p-3 text-sm space-y-2">
                    <div className="font-display text-base">{c.title}</div>
                    <div>
                      <div className="font-medium text-xs uppercase text-muted-foreground mb-1">Steps</div>
                      <ol className="list-decimal pl-5 space-y-1">{c.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                    </div>
                    <div>
                      <div className="font-medium text-xs uppercase text-muted-foreground mb-1">Documents</div>
                      <ul className="list-disc pl-5">{c.documents.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                    <div className="text-xs"><span className="font-medium">Timeline:</span> {c.timeline}</div>
                    <div>
                      <div className="font-medium text-xs uppercase text-muted-foreground mb-1">Risks</div>
                      <ul className="list-disc pl-5 text-destructive/90">{c.risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
          {thinking && <div className="text-sm text-muted-foreground">Thinking…</div>}
        </div>
        <div className="flex gap-2 pt-3">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about renting, buying, listing…" onKeyDown={(e) => { if (e.key === "Enter") send(); }} className="rounded-2xl" />
          <Button onClick={send} className="rounded-2xl" aria-label="Send"><Send className="h-4 w-4" /></Button>
        </div>
      </div>
    </OverlayPanel>
  );
}
