import { json, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getRepository } from "@/lib/repo";
import { missingFields } from "@/lib/engine/products";

export const dynamic = "force-dynamic";

export const GET = route("admin_kb", async () => {
  requireAdmin();
  const repo = getRepository();
  const [kb, imports, changeLog, feedback] = await Promise.all([repo.getKnowledgeBase(), repo.listImports(), repo.listChangeLog(300), repo.listFeedback()]);
  const blocked = kb.products.filter((p) => !p.recommendation_eligible || p.review_status !== "approved").map((p) => ({ id: p.id, variant_name: p.variant_name, review_status: p.review_status, missing: missingFields(p), conflicts: p.conflicts }));
  return json({ kb, imports, changeLog, feedback, blocked, backend: repo.kind });
});
