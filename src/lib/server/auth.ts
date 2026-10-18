import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getConfig } from "./config";

/**
 * Two signed, httpOnly cookies:
 *  - ng_owner: an anonymous owner id, created only when a parent consents to save data.
 *  - ng_admin: an admin session (8h), issued after password login.
 */
export const OWNER_COOKIE = "ng_owner";
export const ADMIN_COOKIE = "ng_admin";

function sign(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export function makeToken(value: string, secret = getConfig().sessionSecret) {
  return `${value}.${sign(value, secret)}`;
}

export function verifyToken(token: string | undefined | null, secret = getConfig().sessionSecret): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const value = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(value, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

const secure = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true";

export function getOwnerId(): string | null {
  return verifyToken(cookies().get(OWNER_COOKIE)?.value);
}

export function getOrCreateOwnerId(): string {
  const existing = getOwnerId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  cookies().set(OWNER_COOKIE, makeToken(id), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 180 });
  return id;
}

export function clearOwner() {
  cookies().set(OWNER_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
}

export function checkAdminPassword(input: string): boolean {
  const cfg = getConfig();
  if (!cfg.admin.enabled) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(cfg.admin.password).digest();
  return crypto.timingSafeEqual(a, b);
}

export function startAdminSession() {
  const exp = Date.now() + 8 * 60 * 60 * 1000;
  cookies().set(ADMIN_COOKIE, makeToken(`admin:${exp}`), { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 8 * 60 * 60 });
}

export function endAdminSession() {
  cookies().set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", secure, path: "/", maxAge: 0 });
}

export function isAdmin(): boolean {
  const cfg = getConfig();
  if (!cfg.admin.enabled) return false;
  const v = verifyToken(cookies().get(ADMIN_COOKIE)?.value);
  if (!v || !v.startsWith("admin:")) return false;
  return Number(v.slice(6)) > Date.now();
}
