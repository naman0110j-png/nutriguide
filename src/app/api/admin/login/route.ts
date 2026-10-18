import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { checkAdminPassword, startAdminSession } from "@/lib/server/auth";
import { getConfig } from "@/lib/server/config";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { n: number; until: number }>();

export const POST = route("admin_login", async (req: Request) => {
  const cfg = getConfig();
  if (!cfg.admin.enabled) throw new HttpError(503, cfg.admin.reason);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
  const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await readJson(req));
  if (!checkAdminPassword(password)) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(ip, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    throw new HttpError(401, "Incorrect password.");
  }
  attempts.delete(ip);
  startAdminSession();
  return json({ ok: true });
});
