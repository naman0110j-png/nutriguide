"use client";
import { useEffect, useState } from "react";
import type { OwnedProduct } from "@/lib/schemas";
import { api } from "@/lib/client/store";
import { Badge } from "@/components/ui";

interface Item { id: string; brand: string; product_family: string; variant_name: string; flavour: string | null; age_guidance_text: string | null; review_status: string; category: string }

export function ProductPicker({ onAdd, existingIds }: { onAdd: (p: OwnedProduct) => void; existingIds: string[] }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [ext, setExt] = useState({ brand: "", product_name: "", variant: "" });

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      api<{ items: Item[] }>(`/api/catalog?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => { setItems(r.items); setError(null); })
        .catch((e) => { if (e.name !== "AbortError") setError("Couldn't load the catalogue. You can still add your product by hand."); })
        .finally(() => setLoading(false));
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  return (
    <div className="rounded-2xl border border-ivory-300 bg-ivory-100 p-4">
      <label htmlFor="product-search" className="label">Search the catalogue</label>
      <input id="product-search" className="input" placeholder="e.g. Nutrimix, calcium gummies" value={q} onChange={(e) => setQ(e.target.value)} aria-describedby="product-search-hint" />
      <p id="product-search-hint" className="hint">Pick the exact age variant and flavour on your pack.</p>
      <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto" aria-live="polite" aria-busy={loading}>
        {items.filter((i) => i.category !== "oral_care").map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm">
            <span>
              <span className="font-medium">{i.variant_name}</span>
              <span className="ml-2 inline-flex gap-1 align-middle">{i.review_status !== "approved" && <Badge tone="incomplete">details not fully verified</Badge>}</span>
            </span>
            <button type="button" className="btn-secondary py-1 text-xs" disabled={existingIds.includes(i.id)}
              onClick={() => onAdd({ catalog_product_id: i.id, is_external_unverified: false, brand: i.brand, product_name: i.product_family, variant: i.flavour ?? undefined, age_variant: i.age_guidance_text?.split(" (")[0]?.slice(0, 40), follows_pack_instructions: "not_sure", wants_help: [] })}>
              {existingIds.includes(i.id) ? "Added" : "Add"}
            </button>
          </li>
        ))}
        {!loading && !items.length && !error && <li className="text-sm text-ink-faint">No match in our catalogue.</li>}
        {error && <li className="text-sm text-clay-700">{error}</li>}
      </ul>
      {!external ? (
        <button type="button" className="mt-3 text-sm text-sage-700 hover:underline" onClick={() => setExternal(true)}>My product isn&rsquo;t listed (any brand)</button>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <div><label className="label" htmlFor="ext-b">Brand</label><input id="ext-b" className="input" value={ext.brand} onChange={(e) => setExt({ ...ext, brand: e.target.value })} /></div>
          <div><label className="label" htmlFor="ext-n">Product</label><input id="ext-n" className="input" value={ext.product_name} onChange={(e) => setExt({ ...ext, product_name: e.target.value })} /></div>
          <div><label className="label" htmlFor="ext-v">Variant</label><input id="ext-v" className="input" value={ext.variant} onChange={(e) => setExt({ ...ext, variant: e.target.value })} /></div>
          <button type="button" className="btn-secondary" disabled={!ext.brand.trim() || !ext.product_name.trim()}
            onClick={() => { onAdd({ catalog_product_id: null, is_external_unverified: true, brand: ext.brand.trim(), product_name: ext.product_name.trim(), variant: ext.variant.trim() || undefined, follows_pack_instructions: "not_sure", wants_help: [] }); setExt({ brand: "", product_name: "", variant: "" }); setExternal(false); }}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
