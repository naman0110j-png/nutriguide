"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Product, Recipe } from "@/lib/schemas";
import { api, store, useSaved } from "@/lib/client/store";
import { Badge, FeedbackButtons, Loading, recipeTone } from "@/components/ui";

const LABEL: Record<string, string> = { verified: "Reviewed recipe", review_required: "Example recipe — review required", demo: "Demo concept — not reviewed" };

export function SavedView() {
  const saved = useSaved();
  const [recipes, setRecipes] = useState<Record<string, Recipe>>({});
  const [products, setProducts] = useState<Record<string, Product>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const rIds = saved.items.filter((i) => i.item_type === "recipe").map((i) => i.item_id);
    const pIds = saved.items.filter((i) => i.item_type === "product").map((i) => i.item_id);
    setLoading(true);
    Promise.all([
      rIds.length ? api<{ items: Recipe[] }>(`/api/recipes?ids=${rIds.join(",")}`).then((r) => Object.fromEntries(r.items.map((x) => [x.id, x]))) : Promise.resolve({}),
      Promise.all(pIds.map((id) => api<{ product: Product }>(`/api/catalog/${id}`).then((r) => [id, r.product] as const).catch(() => null))).then((xs) => Object.fromEntries(xs.filter(Boolean) as [string, Product][])),
    ]).then(([r, p]) => { setRecipes(r); setProducts(p); }).finally(() => setLoading(false));
  }, [saved.items]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <p className="eyebrow">Saved</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Your saved ideas</h1>
        <p className="mt-1 text-sm text-ink-soft">{saved.persistent ? "Saved to your profile in this browser." : "Kept in this tab only — they'll disappear when you close it. Choose “Save this profile” in your profile to keep them."}</p>
      </header>
      {loading && saved.items.length > 0 && <Loading />}
      {!saved.items.length && (
        <div className="card card-pad text-sm text-ink-soft">Nothing saved yet. <Link href="/workspace">Explore food ideas</Link> and tap “Save idea”.</div>
      )}
      <ul className="space-y-3">
        {saved.items.map((i) => {
          const r = i.item_type === "recipe" ? recipes[i.item_id] : undefined;
          const p = i.item_type === "product" ? products[i.item_id] : undefined;
          return (
            <li key={i.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {r && <><Badge tone={recipeTone(r.review_status)}>{LABEL[r.review_status]}</Badge><p className="mt-2 font-display text-lg">{r.name}</p><p className="text-sm text-ink-soft">{r.description}</p><p className="mt-1 text-xs text-ink-faint">{r.prep_time_minutes + r.cook_time_minutes} min · contains {r.allergens.join(", ") || "none of the tracked allergens"}</p></>}
                  {p && <><Badge tone="official">Product information</Badge><p className="mt-2 font-display text-lg"><Link href={`/products/${p.id}`}>{p.variant_name}</Link></p><p className="text-sm text-ink-soft">{p.official_instructions.verified ? `Official instruction: “${p.official_instructions.text}”` : "Official instruction not verified — follow the pack."}</p></>}
                  {!r && !p && !loading && <p className="text-sm text-ink-soft">This item is no longer available ({i.item_id}).</p>}
                </div>
                <button type="button" className="btn-danger py-1.5 text-xs" onClick={() => void saved.remove(i.id)}>Remove</button>
              </div>
              {r && <p className="mt-3 text-xs text-ink-faint">Saved ideas aren&rsquo;t re-checked against later profile changes. Open <Link href="/workspace">food ideas</Link> to see what currently passes your child&rsquo;s checks.</p>}
            </li>
          );
        })}
      </ul>
      <section className="card card-pad">
        <h2 className="text-xl">General feedback</h2>
        <p className="mt-1 text-sm text-ink-soft">Tell us what helped or what was confusing. Please don&rsquo;t include names or contact details.</p>
        <div className="mt-3"><FeedbackButtons type="overview" id="general" profileId={store.getSavedId()} /></div>
      </section>
    </div>
  );
}
