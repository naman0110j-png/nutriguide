import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { ingestDeps, requireAdmin } from "@/lib/server/admin";
import { getRepository } from "@/lib/repo";
import { Ingestor, refresh } from "@/lib/ingest/run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("product"), productId: z.string().min(1) }),
  z.object({ kind: z.literal("category"), category: z.string().min(1) }),
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("url"), url: z.string().url() }),
  z.object({ kind: z.literal("discover"), sitemapUrl: z.string().url().default("https://ourlittlejoys.com/sitemap.xml"), limit: z.number().int().min(1).max(500).default(200) }),
]);

export const POST = route("admin_ingest", async (req: Request) => {
  requireAdmin();
  const body = Body.parse(await readJson(req));
  const repo = getRepository();
  const deps = ingestDeps();
  if (body.kind === "url") return json({ result: await new Ingestor(repo, deps).ingestUrl(body.url) });
  if (body.kind === "discover") {
    const urls = await new Ingestor(repo, deps).discoverFromSitemap(body.sitemapUrl, undefined, body.limit);
    const kb = await repo.getKnowledgeBase();
    const known = new Set(kb.products.map((p) => p.official_url.replace(/\/+$/, "")));
    return json({ discovered: urls.length, not_in_catalogue: urls.filter((u) => !known.has(u.replace(/\/+$/, ""))) });
  }
  const r = await refresh(repo, deps, body);
  return json({ ...r, results: r.results.map((x) => ({
      id: x.id,
      url: x.url,
      status: x.status,
      error: x.error,
      missing_on_page: x.missing_fields,
      // Full diff so reviewers can see values immediately, even where staged storage is ephemeral (demo mode on serverless).
      diff: x.diff.map((d) => ({ field: d.field, critical: d.critical, approved_value: d.previous, newly_extracted_unreviewed: d.next })),
      note: x.diff.some((d) => d.field === "ingredients" && typeof d.previous === "string" && d.previous.startsWith("("))
        ? "The page now provides a fuller ingredient list than the partial list on record. Review it before approving."
        : null,
    })) });
});
