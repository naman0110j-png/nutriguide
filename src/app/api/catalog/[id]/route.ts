import { HttpError, json, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repo";
import { missingFields } from "@/lib/engine/products";

export const dynamic = "force-dynamic";

export const GET = route("catalog_item", async (_req: Request, { params }: { params: { id: string } }) => {
  const kb = await getRepository().getKnowledgeBase();
  const p = kb.products.find((x) => x.id === params.id && x.active);
  if (!p) throw new HttpError(404, "We couldn't find that product.");
  const sources = p.source_ids.map((id) => kb.sources.find((s) => s.id === id)).filter(Boolean);
  const linkedRecipes = kb.recipeProducts.filter((r) => r.product_id === p.id).map((r) => ({ ...r, recipe_name: kb.recipes.find((x) => x.id === r.recipe_id)?.name ?? r.recipe_id }));
  return json({ product: p, sources, missing: missingFields(p), linkedRecipes });
});
