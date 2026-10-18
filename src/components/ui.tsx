"use client";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client/store";

/* ---------------- Labels ---------------- */

const BADGE: Record<string, string> = {
  official: "border-mist-300 bg-mist-50 text-mist-700",
  education: "border-sage-200 bg-sage-50 text-sage-700",
  reviewed: "border-sage-400 bg-sage-100 text-sage-800",
  review_required: "border-clay-300 bg-clay-50 text-clay-700",
  demo: "border-ivory-300 bg-ivory-200 text-ink-soft",
  parent: "border-ivory-300 bg-white text-ink-soft",
  caution: "border-clay-300 bg-clay-50 text-clay-700",
  incomplete: "border-clay-200 bg-white text-clay-700",
  neutral: "border-ivory-300 bg-white text-ink-soft",
};

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof BADGE | string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`chip ${BADGE[tone] ?? BADGE.neutral}`}>
      {children}
    </span>
  );
}

export function recipeTone(status: string) {
  return status === "verified" ? "reviewed" : status === "review_required" ? "review_required" : "demo";
}

export const SOURCE_LABEL: Record<string, { text: string; tone: string }> = {
  parent_reported: { text: "Reported by you", tone: "parent" },
  verified_product: { text: "Official product information", tone: "official" },
  calculated: { text: "Calculated (validated reference)", tone: "reviewed" },
  general_education: { text: "General educational guidance", tone: "education" },
};

/* ---------------- Containers ---------------- */

export function Section({ id, eyebrow, title, children, aside }: { id?: string; eyebrow?: string; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="card card-pad" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
          <h2 id={id ? `${id}-title` : undefined} className="text-xl sm:text-2xl">{title}</h2>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "caution" | "pro" | "error"; title?: string; children: ReactNode }) {
  const cls = {
    info: "border-mist-300/70 bg-mist-50 text-mist-700",
    caution: "border-clay-300/70 bg-clay-50 text-clay-700",
    pro: "border-sage-200 bg-sage-50 text-sage-800",
    error: "border-clay-500/50 bg-clay-50 text-clay-700",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "note"} className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-10 text-sm text-ink-soft">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-sage-200 border-t-sage-700" aria-hidden />
      {label}
    </div>
  );
}

export function SourceList({ sources }: { sources: { id?: string; title: string; url: string; publisher?: string; retrieved_at?: string; source_type?: string }[] }) {
  if (!sources.length) return null;
  return (
    <ul className="space-y-2 text-sm">
      {sources.map((s) => (
        <li key={s.id ?? s.url} className="flex flex-wrap items-baseline gap-x-2">
          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
          <span className="text-xs text-ink-faint">
            {s.publisher}
            {s.retrieved_at ? ` · retrieved ${s.retrieved_at}` : ""}
            {s.source_type?.startsWith("manufacturer") || s.source_type === "official_manufacturer_page" ? " · manufacturer source" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ---------------- Form controls ---------------- */

export function TagInput({ id, label, hint, value, onChange, placeholder, suggestions = [] }: { id: string; label: string; hint?: string; value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])].slice(0, 30));
    setText("");
  };
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="chip border-sage-200 bg-sage-50 text-sage-800">
            {v}
            <button type="button" className="ml-0.5 rounded-full px-1 text-sage-700 hover:bg-sage-100" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
          </span>
        ))}
      </div>
      <input
        id={id}
        className="input"
        value={text}
        placeholder={placeholder ?? "Type and press Enter"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); }
          if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(text)}
      />
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`Suggestions for ${label}`}>
          {suggestions.filter((s) => !value.includes(s)).slice(0, 8).map((s) => (
            <button key={s} type="button" className="chip border-ivory-300 bg-white text-ink-soft hover:border-sage-400" onClick={() => onChange([...value, s])}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Choice<T extends string>({ name, legend, hint, options, value, onChange, multi = false, error }: {
  name: string; legend: string; hint?: string; options: { value: T; label: string; description?: string }[]; value: T | T[] | undefined; onChange: (v: any) => void; multi?: boolean; error?: string;
}) {
  const selected = (v: T) => (multi ? (value as T[] | undefined)?.includes(v) : value === v);
  return (
    <fieldset aria-describedby={error ? `${name}-err` : undefined}>
      <legend className="label">{legend}</legend>
      {hint && <p className="hint">{hint}</p>}
      <div className={`mt-2 grid gap-2 ${options.length > 4 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {options.map((o) => (
          <label key={o.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${selected(o.value) ? "border-sage-600 bg-sage-50" : "border-ivory-300 bg-white hover:border-sage-200"}`}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={name}
              className="mt-0.5 accent-sage-700"
              checked={!!selected(o.value)}
              onChange={() => {
                if (!multi) return onChange(o.value);
                const cur = (value as T[] | undefined) ?? [];
                onChange(cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value]);
              }}
            />
            <span>
              <span className="font-medium text-ink">{o.label}</span>
              {o.description && <span className="block text-xs text-ink-faint">{o.description}</span>}
            </span>
          </label>
        ))}
      </div>
      {error && <p id={`${name}-err`} className="mt-1.5 text-xs font-medium text-clay-700">{error}</p>}
    </fieldset>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <p id={id} className="mt-1.5 text-xs font-medium text-clay-700">{message}</p>;
}

/* ---------------- Feedback ---------------- */

export function FeedbackButtons({ type, id, profileId }: { type: "recipe" | "product_info" | "education" | "overview" | "chat"; id?: string; profileId?: string | null }) {
  const [state, setState] = useState<"idle" | "sent" | "error">("idle");
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const send = async (rating: "helpful" | "not_helpful" | null, feedback_text: string | null = null) => {
    try {
      await api("/api/feedback", { body: { recommendation_type: type, recommendation_id: id ?? null, rating, feedback_text, profile_id: profileId ?? null } });
      setState("sent");
      setOpen(false);
    } catch {
      setState("error");
    }
  };
  if (state === "sent") return <p className="text-xs text-sage-700" role="status">Thanks — your feedback helps us review content.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
      <span>Was this useful?</span>
      <button type="button" className="chip border-ivory-300 bg-white text-ink-soft hover:border-sage-400" onClick={() => send("helpful")}>Yes</button>
      <button type="button" className="chip border-ivory-300 bg-white text-ink-soft hover:border-clay-300" onClick={() => setOpen(true)}>Not really</button>
      {open && (
        <form className="flex w-full flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void send("not_helpful", text.trim() || null); }}>
          <label className="sr-only" htmlFor={`fb-${type}-${id}`}>What could be better?</label>
          <input id={`fb-${type}-${id}`} className="input mt-0 flex-1" maxLength={1000} placeholder="What could be better? (optional — please don’t include names)" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn-secondary py-1.5" type="submit">Send</button>
        </form>
      )}
      {state === "error" && <span className="text-clay-700">Couldn&rsquo;t send — try again.</span>}
    </div>
  );
}
