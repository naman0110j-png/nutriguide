/**
 * Ingestion orchestrator.
 * - Only fetches hosts on the allowlist, only paths robots.txt permits, at a fixed minimum delay.
 * - Writes results to a STAGING import record. Approved product data is never overwritten.
 * - If a critical field differs from the approved record, the product is flagged
 *   `needs_rereview` and removed from recommendations until an admin reviews it.
 */
import crypto from "node:crypto";
import type { Product, ProductImport } from "../schemas";
import type { Repository } from "../repo/types";
import { isAllowed, parseRobots, type RobotsGroup } from "./robots";
import { extractProductPage, parseSitemap, type ExtractedProduct } from "./extract";

export interface IngestDeps {
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  userAgent: string;
  minDelayMs: number;
  allowedHosts: string[];
  actor: string;
}

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
const normUrl = (u: string) => u.replace(/\/+$/, "").replace(/^http:/, "https:").toLowerCase();

export class Ingestor {
  private robots = new Map<string, RobotsGroup[] | "unavailable">();
  private lastFetch = 0;
  private seenCanonical = new Set<string>();

  constructor(private repo: Repository, private deps: IngestDeps) {}

  private async throttle() {
    const wait = this.lastFetch + this.deps.minDelayMs - Date.now();
    if (wait > 0) await this.deps.sleep(wait);
    this.lastFetch = Date.now();
  }

  private async get(url: string): Promise<{ ok: boolean; status: number; text: string }> {
    await this.throttle();
    try {
      const res = await this.deps.fetchImpl(url, { headers: { "user-agent": this.deps.userAgent, accept: "text/html,application/xml" }, redirect: "follow" });
      return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : "" };
    } catch (e) {
      return { ok: false, status: 0, text: String((e as Error)?.message ?? e) };
    }
  }

  async permitted(url: string): Promise<{ ok: boolean; reason?: string }> {
    let u: URL;
    try { u = new URL(url); } catch { return { ok: false, reason: "invalid URL" }; }
    if (u.protocol !== "https:") return { ok: false, reason: "only https is fetched" };
    const host = u.hostname.replace(/^www\./, "");
    if (!this.deps.allowedHosts.includes(host)) return { ok: false, reason: `host ${host} is not on the ingestion allowlist` };
    if (!this.robots.has(host)) {
      const r = await this.get(`https://${u.hostname}/robots.txt`);
      this.robots.set(host, r.ok ? parseRobots(r.text) : r.status === 404 ? [] : "unavailable");
    }
    const groups = this.robots.get(host)!;
    if (groups === "unavailable") return { ok: false, reason: "robots.txt could not be fetched — not crawling (fail closed)" };
    if (!isAllowed(groups, this.deps.userAgent, u.pathname)) return { ok: false, reason: "disallowed by robots.txt" };
    return { ok: true };
  }

  /** Compares extracted fields against the stored (approved) product. */
  static diff(product: Product | undefined, ex: ExtractedProduct): ProductImport["diff"] {
    if (!product) return [];
    const out: ProductImport["diff"] = [];
    if (ex.age_min_months !== null && (ex.age_min_months !== product.age_min_months || ex.age_max_months !== product.age_max_months)) {
      out.push({ field: "age_guidance", previous: { min: product.age_min_months, max: product.age_max_months, text: product.age_guidance_text }, next: { min: ex.age_min_months, max: ex.age_max_months, label: ex.age_label }, critical: true });
    }
    const storedInstr = norm(product.official_instructions.source_quote ?? product.official_instructions.text);
    if (ex.instructions_text && storedInstr && !norm(ex.instructions_text).includes(storedInstr.slice(0, 60))) {
      out.push({ field: "official_instructions", previous: product.official_instructions.source_quote ?? product.official_instructions.text, next: ex.instructions_text, critical: true });
    }
    if (ex.instructions_text && !storedInstr) {
      out.push({ field: "official_instructions", previous: null, next: ex.instructions_text, critical: true });
    }
    if (ex.ingredients_text && product.ingredients.completeness === "complete") {
      const stored = product.ingredients.items.map((i) => norm(i.name));
      const missing = stored.filter((n) => !norm(ex.ingredients_text).includes(n.split(" (")[0]));
      if (missing.length) out.push({ field: "ingredients", previous: product.ingredients.items.map((i) => i.name), next: ex.ingredients_text, critical: true });
    } else if (ex.ingredients_text && product.ingredients.completeness !== "complete") {
      out.push({ field: "ingredients", previous: `(${product.ingredients.completeness} list on record)`, next: ex.ingredients_text, critical: true });
    }
    // Titles and descriptions are marketing copy that changes often; they are kept in the
    // staging record but not treated as diffs.
    return out;
  }

  static missing(ex: ExtractedProduct): string[] {
    const m: string[] = [];
    if (!ex.age_label) m.push("age_guidance");
    if (!ex.instructions_text) m.push("instructions");
    if (!ex.ingredients_text) m.push("ingredients");
    return m;
  }

  async ingestUrl(url: string, opts: { matchProductId?: string } = {}): Promise<ProductImport> {
    const kb = await this.repo.getKnowledgeBase();
    const base: ProductImport = { id: crypto.randomUUID(), url, canonical_url: null, matched_product_id: null, fetched_at: new Date().toISOString(), status: "failed", extracted: {}, diff: [], missing_fields: [], error: null };

    const perm = await this.permitted(url);
    if (!perm.ok) return this.repo.saveImport({ ...base, error: perm.reason ?? "not permitted" });

    const page = await this.get(url);
    if (!page.ok) return this.repo.saveImport({ ...base, error: page.status ? `HTTP ${page.status}` : `fetch failed: ${page.text.slice(0, 120)}` });

    let ex: ExtractedProduct;
    try {
      ex = extractProductPage(page.text, url);
    } catch (e) {
      return this.repo.saveImport({ ...base, error: `extraction failed: ${(e as Error).message}` });
    }
    const canonical = normUrl(ex.canonical_url ?? url);
    if (this.seenCanonical.has(canonical)) {
      return this.repo.saveImport({ ...base, canonical_url: ex.canonical_url, status: "unchanged", extracted: ex as unknown as Record<string, unknown>, error: "duplicate of a page already processed in this run (same canonical URL)" });
    }
    this.seenCanonical.add(canonical);

    const product = opts.matchProductId
      ? kb.products.find((p) => p.id === opts.matchProductId)
      : kb.products.find((p) => normUrl(p.official_url) === canonical || normUrl(p.official_url) === normUrl(url));
    const diff = Ingestor.diff(product, ex);
    const imp: ProductImport = {
      ...base,
      canonical_url: ex.canonical_url,
      matched_product_id: product?.id ?? null,
      status: !product ? "new" : diff.length ? "changed" : "unchanged",
      extracted: { ...ex, previous_review_status: product?.review_status ?? null, previous_recommendation_eligible: product?.recommendation_eligible ?? null } as unknown as Record<string, unknown>,
      diff,
      missing_fields: Ingestor.missing(ex),
    };
    await this.repo.saveImport(imp);

    if (product) {
      const updated: Product = { ...product, last_fetched_at: imp.fetched_at };
      if (diff.some((d) => d.critical)) {
        // Flag for review; keep the approved values in place (audit trail via change log).
        updated.review_status = "needs_rereview";
        updated.recommendation_eligible = false;
        updated.notes = [...product.notes.filter((n) => !n.startsWith("Source changed")), `Source changed on ${imp.fetched_at.slice(0, 10)} (${diff.map((d) => d.field).join(", ")}). Previous approved values kept until reviewed.`];
      }
      await this.repo.upsertEntity("products", updated, this.deps.actor, null);
    }
    return imp;
  }

  async discoverFromSitemap(sitemapUrl: string, filter: (u: string) => boolean = (u) => /\/product\//.test(u), limit = 500): Promise<string[]> {
    const perm = await this.permitted(sitemapUrl);
    if (!perm.ok) throw new Error(perm.reason);
    const res = await this.get(sitemapUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sm = parseSitemap(res.text);
    if (sm.kind === "index") {
      const productMaps = sm.locs.filter((l) => /product/i.test(l));
      const all: string[] = [];
      for (const l of productMaps) all.push(...(await this.discoverFromSitemap(l, filter, limit)));
      return [...new Set(all)].slice(0, limit);
    }
    return sm.locs.filter(filter).slice(0, limit);
  }
}

export type RefreshScope = { kind: "product"; productId: string } | { kind: "category"; category: string } | { kind: "all" };

export async function refresh(repo: Repository, deps: IngestDeps, scope: RefreshScope) {
  const kb = await repo.getKnowledgeBase();
  const targets =
    scope.kind === "product" ? kb.products.filter((p) => p.id === scope.productId)
      : scope.kind === "category" ? kb.products.filter((p) => p.category === scope.category && p.active)
        : kb.products.filter((p) => p.active);
  const ing = new Ingestor(repo, deps);
  const results: ProductImport[] = [];
  for (const p of targets) results.push(await ing.ingestUrl(p.official_url, { matchProductId: p.id }));
  return {
    attempted: targets.length,
    changed: results.filter((r) => r.status === "changed").length,
    unchanged: results.filter((r) => r.status === "unchanged").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
