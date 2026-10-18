import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log } from "./log";

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function readJson(req: Request, maxBytes = 64_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

/** Wraps a route handler with consistent, non-leaky error responses. */
export function route<A extends unknown[]>(name: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const started = Date.now();
    try {
      const res = await fn(...args);
      log.info("api", { route: name, status: res.status, ms: Date.now() - started });
      return res;
    } catch (e) {
      if (e instanceof ZodError) {
        return json({ error: "Some fields need attention.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
      }
      if (e instanceof HttpError) return json({ error: e.message, details: e.details ?? null }, e.status);
      log.error("api_error", e, { route: name });
      const msg = String((e as Error)?.message ?? "");
      if (msg.startsWith("Database error")) return json({ error: "We couldn't reach the database. Please try again shortly." }, 503);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  };
}
