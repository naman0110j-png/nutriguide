import "server-only";
import { HttpError } from "./http";
import { isAdmin } from "./auth";
import { getConfig } from "./config";
import type { IngestDeps } from "../ingest/run";

export function requireAdmin() {
  const cfg = getConfig();
  if (!cfg.admin.enabled) throw new HttpError(503, cfg.admin.reason);
  if (!isAdmin()) throw new HttpError(401, "Admin sign-in required.");
}

export function ingestDeps(): IngestDeps {
  const cfg = getConfig();
  if (!cfg.ingest.enabled) throw new HttpError(503, "Ingestion is disabled (INGEST_ENABLED=false).");
  return {
    fetchImpl: fetch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    userAgent: cfg.ingest.userAgent,
    minDelayMs: cfg.ingest.minDelayMs,
    allowedHosts: cfg.ingest.allowedHosts,
    actor: "importer",
  };
}
