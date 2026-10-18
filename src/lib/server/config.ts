import "server-only";
import crypto from "node:crypto";

/** Server-only configuration. Nothing here is ever sent to the browser. */
export interface AppConfig {
  dataBackend: "demo" | "supabase";
  contentMode: "demo" | "production";
  supabase: { url: string; serviceRoleKey: string } | null;
  llm: { provider: "anthropic" | "openai"; apiKey: string; model: string; baseUrl: string | null; timeoutMs: number } | null;
  admin: { password: string; enabled: true } | { enabled: false; reason: string };
  sessionSecret: string;
  sessionSecretIsEphemeral: boolean;
  ingest: { enabled: boolean; userAgent: string; minDelayMs: number; allowedHosts: string[] };
  demoStorePath: string;
  configIssues: string[];
}

let cached: AppConfig | null = null;
const ephemeralSecret = crypto.randomBytes(32).toString("hex");

export function getConfig(): AppConfig {
  if (cached) return cached;
  const env = process.env;
  const issues: string[] = [];

  let dataBackend: AppConfig["dataBackend"] = env.DATA_BACKEND === "supabase" ? "supabase" : "demo";
  let supabase: AppConfig["supabase"] = null;
  if (dataBackend === "supabase") {
    if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      supabase = { url: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY };
    } else {
      issues.push("DATA_BACKEND=supabase but NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing — falling back to the demo store.");
      dataBackend = "demo";
    }
  }

  let llm: AppConfig["llm"] = null;
  const provider = (env.LLM_PROVIDER ?? "none").toLowerCase();
  if (provider === "anthropic" || provider === "openai") {
    if (env.LLM_API_KEY && env.LLM_MODEL) {
      llm = {
        provider,
        apiKey: env.LLM_API_KEY,
        model: env.LLM_MODEL,
        baseUrl: env.LLM_BASE_URL || null,
        timeoutMs: Number(env.LLM_TIMEOUT_MS) > 0 ? Number(env.LLM_TIMEOUT_MS) : 20000,
      };
    } else {
      issues.push(`LLM_PROVIDER=${provider} but LLM_API_KEY or LLM_MODEL is missing — AI explanations disabled (deterministic fallback in use).`);
    }
  }

  const sessionSecret = env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 ? env.SESSION_SECRET : ephemeralSecret;
  const sessionSecretIsEphemeral = sessionSecret === ephemeralSecret;
  if (sessionSecretIsEphemeral) issues.push("SESSION_SECRET not set — using a random per-process secret (sessions reset on restart).");

  const admin: AppConfig["admin"] =
    env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8 && !sessionSecretIsEphemeral
      ? { enabled: true, password: env.ADMIN_PASSWORD }
      : { enabled: false, reason: "Admin is disabled until ADMIN_PASSWORD (8+ chars) and SESSION_SECRET (16+ chars) are set on the server." };

  cached = {
    dataBackend,
    contentMode: env.CONTENT_MODE === "production" ? "production" : "demo",
    supabase,
    llm,
    admin,
    sessionSecret,
    sessionSecretIsEphemeral,
    ingest: {
      enabled: env.INGEST_ENABLED !== "false",
      userAgent: env.INGEST_USER_AGENT || "NutriGuideImporter/0.1",
      minDelayMs: Math.max(1000, Number(env.INGEST_MIN_DELAY_MS) || 2500),
      allowedHosts: (env.INGEST_ALLOWED_HOSTS || "ourlittlejoys.com,mosaicwellness.in").split(",").map((s) => s.trim()).filter(Boolean),
    },
    demoStorePath: env.DEMO_STORE_PATH || (env.VERCEL ? "/tmp/nutriguide-demo-store.json" : ".data/demo-store.json"),
    configIssues: issues,
  };
  return cached;
}

/** Public, non-secret status flags safe to expose to the UI. */
export function publicStatus() {
  const c = getConfig();
  return {
    dataBackend: c.dataBackend,
    contentMode: c.contentMode,
    aiLive: !!c.llm,
    aiProvider: c.llm?.provider ?? null,
    adminEnabled: c.admin.enabled,
    demo: c.dataBackend === "demo" || !c.llm || c.contentMode === "demo",
  };
}

/** Test helper. */
export function __resetConfigForTests() {
  cached = null;
}
