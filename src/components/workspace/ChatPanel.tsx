"use client";
import { useEffect, useRef, useState } from "react";
import type { ChildProfile } from "@/lib/schemas";
import { api, ApiError } from "@/lib/client/store";
import { Badge, FeedbackButtons } from "@/components/ui";
import type { ChatReply } from "./types";

interface Msg { role: "user" | "assistant"; text: string; reply?: ChatReply }

const STARTERS = [
  "Can you suggest another breakfast idea?",
  "Can you show an option without eggs?",
  "Why did you suggest these ideas?",
  "What information is missing?",
  "Can you explain the official product instructions?",
  "What is jaggery?",
];

export function ChatPanel({ profile, concern, shownRecipeIds, profileId }: { profile: ChildProfile; concern: string; shownRecipeIds: string[]; profileId: string | null }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Hi! I can suggest other ideas, filter out an ingredient, explain why something was suggested, or explain a product's official instructions. I can't diagnose or advise on doses — for that, please ask your paediatrician." },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  async function ask(q: string) {
    const message = q.trim();
    if (!message || busy) return;
    setMsgs((m) => [...m, { role: "user", text: message }]);
    setText("");
    setBusy(true);
    try {
      const reply = await api<ChatReply>("/api/chat", { body: { profile, message, concern, shownRecipeIds } });
      setMsgs((m) => [...m, { role: "assistant", text: reply.answer, reply }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: e instanceof ApiError ? e.message : "Sorry — I couldn't answer that just now. Please try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card flex h-[34rem] min-w-0 flex-col lg:sticky lg:top-20" aria-label="Assistant">
      <div className="border-b border-ivory-300 px-4 py-3">
        <p className="font-display text-lg">Ask about these ideas</p>
        <p className="text-xs text-ink-faint">Answers use the same safety rules as the ideas on this page.</p>
      </div>
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 rounded-2xl rounded-br-sm bg-sage-700 px-3.5 py-2 text-sm text-white" : "mr-4 rounded-2xl rounded-bl-sm bg-ivory-200 px-3.5 py-2 text-sm text-ink"}>
            {m.reply && ["emergency", "diagnosis_refusal", "dosing_refusal"].includes(m.reply.kind) && (
              <div className="mb-1"><Badge tone="caution">{m.reply.kind === "emergency" ? "Urgent" : "Needs a professional"}</Badge></div>
            )}
            <p className="whitespace-pre-line">{m.text}</p>
            {m.reply?.sources?.length ? (
              <p className="mt-1 text-xs text-ink-faint">Source: {m.reply.sources.map((s, j) => <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className="mr-2">{s.title}</a>)}</p>
            ) : null}
            {m.reply && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-ink-faint">{m.reply.generated_by === "llm" ? "Worded by AI from checked facts" : "From reviewed templates"}</span>
                <FeedbackButtons type="chat" id={m.reply.kind} profileId={profileId} />
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-xs text-ink-faint" role="status">Thinking…</p>}
      </div>
      <div className="border-t border-ivory-300 p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {STARTERS.map((s) => (
            <button key={s} type="button" className="chip shrink-0 border-ivory-300 bg-white py-1 text-ink-soft hover:border-sage-400" onClick={() => void ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
          <label htmlFor="chat-input" className="sr-only">Your question</label>
          <input id="chat-input" className="input mt-0 flex-1" maxLength={600} placeholder="Ask a question…" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn-primary px-4" disabled={busy || !text.trim()}>Send</button>
        </form>
      </div>
    </aside>
  );
}
