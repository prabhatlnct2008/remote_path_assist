"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Markdown } from "@/components/case/Markdown";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STARTER = "Ask me about this case…";

export function ChatSidebar({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  async function send() {
    const q = input.trim();
    if (!q || streaming) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId, messages: next }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(res.status === 503 ? "AI is not configured." : "Chat failed.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: "assistant", content: acc };
          return copy;
        });
      }
      // Turn is persisted server-side as comments; refresh the thread.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setStreaming(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white shadow-lg"
      >
        AI chat
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 flex h-[60vh] w-96 flex-col rounded-lg border border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium">Case AI chat</span>
        <button onClick={() => setOpen(false)} className="text-sm text-muted-foreground">
          ✕
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        {messages.length === 0 && <p className="text-muted-foreground">{STARTER}</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-foreground" : "rounded-md bg-violet-50/60 p-2"}>
            {m.role === "user" ? (
              <p className="font-medium">{m.content}</p>
            ) : (
              <Markdown>{m.content || "…"}</Markdown>
            )}
          </div>
        ))}
        {error && <p className="text-red-600">{error}</p>}
      </div>
      <div className="flex gap-2 border-t border-border p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about this case…"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
