import "server-only";
import path from "node:path";
import { getConfig } from "../server/config";
import { MemoryRepository } from "./memory";
import { SupabaseRepository } from "./supabase";
import type { Repository } from "./types";

let repo: Repository | null = null;

export function getRepository(): Repository {
  if (repo) return repo;
  const cfg = getConfig();
  if (cfg.dataBackend === "supabase" && cfg.supabase) {
    repo = new SupabaseRepository(cfg.supabase.url, cfg.supabase.serviceRoleKey);
  } else {
    const p = path.isAbsolute(cfg.demoStorePath) ? cfg.demoStorePath : path.join(process.cwd(), cfg.demoStorePath);
    repo = new MemoryRepository(p);
  }
  return repo;
}

export type { Repository } from "./types";
