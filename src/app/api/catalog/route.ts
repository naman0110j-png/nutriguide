import { json, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repo";
import { missingFields } from "@/lib/engine/products";

export const dynamic = "force-dynamic";

export const GET = route("catalog", async (req: Request) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const category = url.searchParams.get("category");
  const kb = await getRepository().getKnowledgeBase();
  const items = kb.products
    .filter((p) => p.active && p.review_status !== "rejected")
    .filter((p) => !category || p.category === category)
    .filter((p) => !q || [p.variant_name, p.product_family, p.flavour ?? "", p.brand, p.category].join(" ").toLowerCase().includes(q))
    .map((p) => ({
      id: p.id, brand: p.brand, product_family: p.product_family, variant_name: p.variant_name, category: p.category,
      flavour: p.flavour, pack_size: p.pack_size, age_min_months: p.age_min_months, age_max_months: p.age_max_months,
      age_guidance_text: p.age_guidance_text, allergens: p.allergen_data.contains, allergen_basis: p.allergen_data.basis,
      review_status: p.review_status, field_status: p.field_status, missing: missingFields(p), official_url: p.official_url,
      last_reviewed_at: p.last_reviewed_at,
    }));
  return json({ items, total: items.length });
});
