import { json, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Recipe lookup by id (for saved items). Eligibility is NOT re-checked here; the saved page says so. */
export const GET = route("recipes", async (req: Request) => {
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  const kb = await getRepository().getKnowledgeBase();
  const items = kb.recipes.filter((r) => ids.includes(r.id) && r.active && r.review_status !== "unavailable");
  return json({ items });
});
