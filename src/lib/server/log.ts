/**
 * Minimal logger that never writes questionnaire answers, prompts or model output.
 * Only event names and non-sensitive metadata (counts, ids, durations, error classes).
 */
type Meta = Record<string, string | number | boolean | null | undefined>;

const SENSITIVE_KEYS = /profile|prompt|allerg|concern|nickname|message|text|answer|meal|content/i;

function clean(meta: Meta = {}): Meta {
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : v;
  return out;
}

export const log = {
  info(event: string, meta?: Meta) {
    if (process.env.NODE_ENV !== "test") console.log(JSON.stringify({ level: "info", event, ...clean(meta), at: new Date().toISOString() }));
  },
  warn(event: string, meta?: Meta) {
    if (process.env.NODE_ENV !== "test") console.warn(JSON.stringify({ level: "warn", event, ...clean(meta), at: new Date().toISOString() }));
  },
  error(event: string, err: unknown, meta?: Meta) {
    const e = err instanceof Error ? { error: err.name, error_message: err.message.slice(0, 200) } : { error: String(err).slice(0, 200) };
    if (process.env.NODE_ENV !== "test") console.error(JSON.stringify({ level: "error", event, ...e, ...clean(meta), at: new Date().toISOString() }));
  },
};
