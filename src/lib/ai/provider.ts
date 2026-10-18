/**
 * Provider-agnostic LLM call. Server-side only: the API key never leaves the server.
 * Supports Anthropic Messages API and any OpenAI-compatible chat-completions endpoint.
 */
export interface LlmConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  model: string;
  baseUrl: string | null;
  timeoutMs: number;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export class LlmError extends Error {
  constructor(message: string, readonly kind: "timeout" | "http" | "network" | "empty") {
    super(message);
    this.name = "LlmError";
  }
}

export type FetchLike = typeof fetch;

export async function callLlm(cfg: LlmConfig, req: LlmRequest, fetchImpl: FetchLike = fetch): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  try {
    let res: Response;
    if (cfg.provider === "anthropic") {
      res = await fetchImpl(`${cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: cfg.model, max_tokens: req.maxTokens ?? 1500, system: req.system, messages: [{ role: "user", content: req.user }] }),
      });
    } else {
      res = await fetchImpl(`${cfg.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, max_tokens: req.maxTokens ?? 1500, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] }),
      });
    }
    if (!res.ok) throw new LlmError(`Provider returned HTTP ${res.status}`, "http");
    const body = (await res.json()) as Record<string, unknown>;
    const text =
      cfg.provider === "anthropic"
        ? ((body.content as { type: string; text?: string }[] | undefined) ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
        : (((body.choices as { message?: { content?: string } }[] | undefined) ?? [])[0]?.message?.content ?? "");
    if (!text.trim()) throw new LlmError("Provider returned an empty response", "empty");
    return text;
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if ((e as Error)?.name === "AbortError") throw new LlmError("Provider timed out", "timeout");
    throw new LlmError("Could not reach the provider", "network");
  } finally {
    clearTimeout(timer);
  }
}
