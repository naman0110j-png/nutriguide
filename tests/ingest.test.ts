import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRobots, isAllowed } from "@/lib/ingest/robots";
import { extractProductPage, parseSitemap, parseAge } from "@/lib/ingest/extract";
import { Ingestor, refresh, type IngestDeps } from "@/lib/ingest/run";
import { MemoryRepository } from "@/lib/repo/memory";

const FIX = path.join(__dirname, "fixtures");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");

// robots.txt as published on ourlittlejoys.com (retrieved 2026-10-18).
const ROBOTS = `User-agent: *
Disallow: /habit/*
Disallow: /status/*
Disallow: /orderdetails/*
Sitemap: https://ourlittlejoys.com/sitemap.xml

User-agent: Googlebot
Allow: /

User-agent: OAI-SearchBot
Disallow:`;

function fakeSite(pages: Record<string, string | number>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const body = pages[url];
    if (body === undefined) return new Response("not found", { status: 404 });
    if (typeof body === "number") return new Response("", { status: body });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const deps = (fetchImpl: typeof fetch, extra: Partial<IngestDeps> = {}): IngestDeps => ({
  fetchImpl,
  sleep: async () => {},
  userAgent: "NutriGuideImporter/0.1",
  minDelayMs: 0,
  allowedHosts: ["ourlittlejoys.com"],
  actor: "importer",
  ...extra,
});

const tmpRepo = () => new MemoryRepository(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ng-ing-")), "s.json"));
const NM = "https://ourlittlejoys.com/product/nutrimix-nutrition-powder";

describe("robots.txt", () => {
  const g = parseRobots(ROBOTS);
  it("respects the real Little Joys rules", () => {
    expect(isAllowed(g, "NutriGuideImporter/0.1", "/product/nutrimix-nutrition-powder")).toBe(true);
    expect(isAllowed(g, "NutriGuideImporter/0.1", "/habit/123")).toBe(false);
    expect(isAllowed(g, "NutriGuideImporter/0.1", "/orderdetails/9")).toBe(false);
  });
  it("applies longest-match and agent-specific groups", () => {
    const g2 = parseRobots("User-agent: *\nDisallow: /product/\nAllow: /product/public\n\nUser-agent: nutriguideimporter\nDisallow: /");
    expect(isAllowed(g2, "OtherBot", "/product/public-page")).toBe(true);
    expect(isAllowed(g2, "OtherBot", "/product/x")).toBe(false);
    expect(isAllowed(g2, "NutriGuideImporter/0.1", "/anything")).toBe(false);
  });
});

describe("extraction", () => {
  it("extracts canonical, age, instructions from a product page fixture", () => {
    const ex = extractProductPage(read("nutrimix-2-6.html"), NM);
    expect(ex.canonical_url).toBe(NM);
    expect(ex.age_label).toBe("2-6 Yr");
    expect(ex.age_min_months).toBe(24);
    expect(ex.age_max_months).toBe(83);
    expect(ex.instructions_text).toMatch(/2 scoops \(30 g\).*200 ml/);
  });
  it("extracts a full ingredient list when present", () => {
    const ex = extractProductPage(read("choco-fills.html"), "https://ourlittlejoys.com/product/millet-choco-fills");
    expect(ex.ingredients_text).toMatch(/Groundnut Oil/);
    expect(ex.ingredients_text).toMatch(/Skim Milk Powder/);
  });
  it("ignores a 'View Full List of Ingredients' link and non-list text (live-page false positive)", () => {
    const html = `<html><body><div>2-6 Yr</div><a href="#">View Full List of Ingredients</a>
      <h2>Questions you should be asking. Answers that we believe must be heard.</h2>
      <h3>How to prepare 1 serving of Nutrimix?</h3><p>Mix 2 scoops (30 g) of the nutrition powder with 200 ml of lukewarm or cold milk to prepare 1 serving of Nutrimix.</p></body></html>`;
    const ex = extractProductPage(html, NM);
    expect(ex.ingredients_text).toBeNull();
    expect(ex.instructions_text).toMatch(/2 scoops/);
  });

  it("parses age labels and sitemaps", () => {
    expect(parseAge("5+ Yr")).toEqual({ min: 60, max: null });
    expect(parseAge("7–12 Yr")).toEqual({ min: 84, max: 155 });
    const sm = parseSitemap(`<urlset><url><loc>${NM}</loc></url><url><loc>${NM}</loc></url></urlset>`);
    expect(sm.locs).toEqual([NM]);
  });
});

describe("ingestion runs", () => {
  it("unchanged page: keeps approval, records timestamp and source URL", async () => {
    const repo = tmpRepo();
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS, [NM]: read("nutrimix-2-6.html") });
    const imp = await new Ingestor(repo, deps(site.fetchImpl)).ingestUrl(NM);
    expect(imp.status).toBe("unchanged");
    expect(imp.matched_product_id).toBe("lj-nutrimix-2-6-chocolate-350g");
    expect(imp.url).toBe(NM);
    expect(imp.fetched_at).toBeTruthy();
    const p = (await repo.getKnowledgeBase()).products.find((x) => x.id === "lj-nutrimix-2-6-chocolate-350g")!;
    expect(p.review_status).toBe("approved");
    expect(p.last_fetched_at).toBe(imp.fetched_at);
  });

  it("changed critical field: flags needs_rereview, removes eligibility, keeps approved values", async () => {
    const repo = tmpRepo();
    const changed = read("nutrimix-2-6.html").replace("Mix 2 scoops (30 g)", "Mix 3 scoops (45 g)");
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS, [NM]: changed });
    const imp = await new Ingestor(repo, deps(site.fetchImpl)).ingestUrl(NM);
    expect(imp.status).toBe("changed");
    expect(imp.diff.map((d) => d.field)).toContain("official_instructions");
    const p = (await repo.getKnowledgeBase()).products.find((x) => x.id === "lj-nutrimix-2-6-chocolate-350g")!;
    expect(p.review_status).toBe("needs_rereview");
    expect(p.recommendation_eligible).toBe(false);
    expect(p.official_instructions.text).toMatch(/2 scoops \(30 g\)/); // not overwritten
    const log = await repo.listChangeLog();
    expect(log.some((e) => e.entity_id === p.id && e.field === "review_status" && e.previous_value === "approved")).toBe(true);
  });

  it("deduplicates the same canonical page reached via different URLs", async () => {
    const repo = tmpRepo();
    const alt = `${NM}?source=header`;
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS, [NM]: read("nutrimix-2-6.html"), [alt]: read("nutrimix-2-6.html") });
    const ing = new Ingestor(repo, deps(site.fetchImpl));
    await ing.ingestUrl(NM);
    const second = await ing.ingestUrl(alt);
    expect(second.error).toMatch(/duplicate/);
    const kbAfter = await repo.getKnowledgeBase();
    expect(kbAfter.products.filter((p) => p.official_url === NM)).toHaveLength(1);
  });

  it("refuses disallowed paths, foreign hosts and fails closed if robots.txt is unreachable", async () => {
    const repo = tmpRepo();
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS });
    const ing = new Ingestor(repo, deps(site.fetchImpl));
    expect((await ing.ingestUrl("https://ourlittlejoys.com/habit/abc")).error).toMatch(/robots/);
    expect((await ing.ingestUrl("https://example.com/product/x")).error).toMatch(/allowlist/);
    const down = fakeSite({ "https://ourlittlejoys.com/robots.txt": 503 });
    expect((await new Ingestor(tmpRepo(), deps(down.fetchImpl)).ingestUrl(NM)).error).toMatch(/fail closed/);
    expect(down.calls).not.toContain(NM);
  });

  it("failed fetches do not corrupt approved data", async () => {
    const repo = tmpRepo();
    const before = JSON.stringify((await repo.getKnowledgeBase()).products);
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS, [NM]: 500 });
    const imp = await new Ingestor(repo, deps(site.fetchImpl)).ingestUrl(NM);
    expect(imp.status).toBe("failed");
    expect(JSON.stringify((await repo.getKnowledgeBase()).products)).toBe(before);
  });

  it("enforces the minimum delay between requests", async () => {
    const waits: number[] = [];
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS, [NM]: read("nutrimix-2-6.html") });
    await new Ingestor(tmpRepo(), deps(site.fetchImpl, { minDelayMs: 2500, sleep: async (ms) => { waits.push(ms); } })).ingestUrl(NM);
    expect(waits.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...waits)).toBeGreaterThan(2000);
  });

  it("category refresh covers only that category", async () => {
    const repo = tmpRepo();
    const site = fakeSite({ "https://ourlittlejoys.com/robots.txt": ROBOTS });
    const r = await refresh(repo, deps(site.fetchImpl), { kind: "category", category: "gummies" });
    expect(r.attempted).toBe(2);
    expect(r.failed).toBe(2); // pages 404 in the fake site
  });
});
