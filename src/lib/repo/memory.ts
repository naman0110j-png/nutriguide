/**
 * Demo repository: seeded knowledge base + a local JSON file for parent data, admin
 * edits, imports and the change log. Suitable for local demos and tests — NOT for
 * production (single process, no encryption at rest). Use the Supabase backend for that.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { seedKnowledgeBase } from "@/data/seed";
import type { KnowledgeBase } from "../kb";
import type { ChangeLogEntry, ChildProfile, Feedback, ProductImport, SavedItem } from "../schemas";
import { diffRecords } from "./diff";
import { ENTITY_SCHEMAS, ENTITY_STATUSES, type EntityKind, type Repository, type StoredFeedback, type StoredProfile, type StoredSaved } from "./types";

interface StoreShape {
  version: 1;
  kb: KnowledgeBase;
  profiles: StoredProfile[];
  saved: StoredSaved[];
  feedback: StoredFeedback[];
  changeLog: ChangeLogEntry[];
  imports: ProductImport[];
}

const STATUS_FIELD = "review_status";

export class MemoryRepository implements Repository {
  readonly kind = "demo" as const;
  private state: StoreShape | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  private load(): StoreShape {
    if (this.state) return this.state;
    if (this.filePath && fs.existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as StoreShape;
        if (parsed.version === 1 && parsed.kb) {
          this.state = parsed;
          return parsed;
        }
      } catch {
        // Corrupt store: start fresh from seed rather than crash. (File kept as .corrupt for inspection.)
        try { fs.renameSync(this.filePath, `${this.filePath}.corrupt`); } catch { /* ignore */ }
      }
    }
    this.state = { version: 1, kb: seedKnowledgeBase(), profiles: [], saved: [], feedback: [], changeLog: [], imports: [] };
    return this.state;
  }

  /** Serialise writes and persist atomically (write temp file, then rename). */
  private mutate<T>(fn: (s: StoreShape) => T): Promise<T> {
    const run = this.chain.then(() => {
      const s = this.load();
      const draft = structuredClone(s);
      const result = fn(draft);
      if (this.filePath) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(draft));
        fs.renameSync(tmp, this.filePath);
      }
      this.state = draft; // commit only after a successful write
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async getKnowledgeBase(): Promise<KnowledgeBase> {
    return structuredClone(this.load().kb);
  }

  async saveProfile(ownerId: string, profile: ChildProfile, id?: string): Promise<StoredProfile> {
    return this.mutate((s) => {
      const now = new Date().toISOString();
      const existing = id ? s.profiles.find((p) => p.id === id && p.owner_id === ownerId) : undefined;
      if (existing) {
        existing.profile = { ...profile, id: existing.id };
        existing.updated_at = now;
        return structuredClone(existing);
      }
      const rec: StoredProfile = { id: crypto.randomUUID(), owner_id: ownerId, profile, created_at: now, updated_at: now };
      rec.profile = { ...profile, id: rec.id };
      s.profiles.push(rec);
      return structuredClone(rec);
    });
  }

  async getProfile(ownerId: string, id: string) {
    const p = this.load().profiles.find((x) => x.id === id && x.owner_id === ownerId);
    return p ? structuredClone(p) : null;
  }

  async listProfiles(ownerId: string) {
    return structuredClone(this.load().profiles.filter((p) => p.owner_id === ownerId));
  }

  async deleteProfile(ownerId: string, id: string) {
    return this.mutate((s) => {
      const before = s.profiles.length;
      s.profiles = s.profiles.filter((p) => !(p.id === id && p.owner_id === ownerId));
      // Detach feedback from the deleted profile (feedback is anonymous).
      s.feedback.forEach((f) => { if (f.profile_id === id) f.profile_id = null; });
      return s.profiles.length < before;
    });
  }

  async deleteAllOwnerData(ownerId: string) {
    return this.mutate((s) => {
      const ids = new Set(s.profiles.filter((p) => p.owner_id === ownerId).map((p) => p.id));
      const profiles = ids.size;
      const saved = s.saved.filter((x) => x.owner_id === ownerId).length;
      s.profiles = s.profiles.filter((p) => p.owner_id !== ownerId);
      s.saved = s.saved.filter((x) => x.owner_id !== ownerId);
      s.feedback.forEach((f) => { if (f.profile_id && ids.has(f.profile_id)) f.profile_id = null; });
      return { profiles, saved };
    });
  }

  async listSaved(ownerId: string) {
    return structuredClone(this.load().saved.filter((x) => x.owner_id === ownerId));
  }

  async addSaved(ownerId: string, item: SavedItem) {
    return this.mutate((s) => {
      const dup = s.saved.find((x) => x.owner_id === ownerId && x.item_type === item.item_type && x.item_id === item.item_id);
      if (dup) return structuredClone(dup);
      const rec: StoredSaved = { ...item, id: crypto.randomUUID(), owner_id: ownerId, created_at: new Date().toISOString() };
      s.saved.push(rec);
      return structuredClone(rec);
    });
  }

  async removeSaved(ownerId: string, id: string) {
    return this.mutate((s) => {
      const before = s.saved.length;
      s.saved = s.saved.filter((x) => !(x.id === id && x.owner_id === ownerId));
      return s.saved.length < before;
    });
  }

  async addFeedback(profileId: string | null, fb: Feedback) {
    return this.mutate((s) => {
      const rec: StoredFeedback = { ...fb, id: crypto.randomUUID(), profile_id: profileId, created_at: new Date().toISOString() };
      s.feedback.push(rec);
      return structuredClone(rec);
    });
  }

  async listFeedback() {
    return structuredClone(this.load().feedback).reverse();
  }

  async upsertEntity(kind: EntityKind, record: unknown, actor: string, sourceId: string | null = null) {
    const parsed = ENTITY_SCHEMAS[kind].parse(record) as unknown as { id: string } & Record<string, unknown>;
    return this.mutate((s) => {
      const list = s.kb[kind] as unknown as ({ id: string } & Record<string, unknown>)[];
      const idx = list.findIndex((x) => x.id === parsed.id);
      const prev = idx >= 0 ? list[idx] : undefined;
      const next = { ...parsed, ...("updated_at" in parsed ? { updated_at: new Date().toISOString() } : {}) };
      const changes = diffRecords(kind, parsed.id, prev, next, actor, sourceId);
      if (idx >= 0) list[idx] = next;
      else list.push(next);
      s.changeLog.push(...changes);
      return { record: structuredClone(next), changes };
    });
  }

  async setEntityStatus(kind: EntityKind, id: string, status: string, actor: string) {
    if (!ENTITY_STATUSES[kind].includes(status)) throw new Error(`Invalid status '${status}' for ${kind}`);
    return this.mutate((s) => {
      const list = s.kb[kind] as unknown as ({ id: string } & Record<string, unknown>)[];
      const item = list.find((x) => x.id === id);
      if (!item) throw new Error("Not found");
      const prev = structuredClone(item);
      item[STATUS_FIELD] = status;
      if (kind === "products") {
        item.last_reviewed_at = new Date().toISOString();
        item.reviewed_by = actor;
        if (status !== "approved") item.recommendation_eligible = false;
      }
      if ("updated_at" in item) item.updated_at = new Date().toISOString();
      s.changeLog.push(...diffRecords(kind, id, prev, item, actor));
      return structuredClone(item);
    });
  }

  async listChangeLog(limit = 200) {
    return structuredClone(this.load().changeLog.slice(-limit)).reverse();
  }

  async appendChangeLog(entries: ChangeLogEntry[]) {
    await this.mutate((s) => { s.changeLog.push(...entries); });
  }

  async listImports() {
    return structuredClone(this.load().imports).reverse();
  }

  async saveImport(imp: ProductImport) {
    return this.mutate((s) => {
      const i = s.imports.findIndex((x) => x.id === imp.id);
      if (i >= 0) s.imports[i] = imp;
      else s.imports.push(imp);
      return structuredClone(imp);
    });
  }

  async getImport(id: string) {
    const i = this.load().imports.find((x) => x.id === id);
    return i ? structuredClone(i) : null;
  }
}
