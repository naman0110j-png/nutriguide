"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ALLERGEN_LABELS } from "@/lib/kb";
import { api } from "@/lib/client/store";
import { Badge, Loading, Notice } from "@/components/ui";

interface Item {
  id: string; brand: string; product_family: string; variant_name: string; category: string; flavour: string | null; pack_size: string | null;
  age_guidance_text: string | null; allergens: string[]; allergen_basis: string; review_status: string; field_status: Record<string, string>; missing: string[]; official_url: string; last_reviewed_at: string | null;
}

const CATS = [
  { v: "", l: "All" },
  { v: "nutrition_powder", l: "Nutrition powders" },
  { v: "gummies", l: "Gummies" },
  { v: "snack", l: "Snacks" },
  { v: "oral_care", l: "Oral care" },
];

const STATUS: Record<string, { t: string; tone: string }> = {
  approved: { t: "Checked against official page", tone: "official" },
  pending_review: { t: "Partly verified", tone: "incomplete" },
  needs_rereview: { t: "Source changed — under review", tone: "caution" },
};

export function Catalogue() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ items: Item[] }>(`/api/catalog?q=${encodeURIComponent(q)}${cat ? `&category=${cat}` : ""}`, { signal: ctrl.signal })
        .then((r) => { setItems(r.items); setError(null); })
        .catch((e) => { if (e.name !== "AbortError") setError("Couldn't load the catalogue."); });
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, cat]);

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Product catalogue</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Exact variants, with their sources</h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">Each variant is kept separate, because age bands, ingredients and instructions can differ. Anything we haven&rsquo;t verified is marked as such — we don&rsquo;t fill gaps with plausible-looking values.</p>
      </header>
      <div className="card card-pad flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="q" className="label">Search</label>
          <input id="q" className="input" placeholder="Nutrimix, calcium, toothpaste…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div role="group" aria-label="Category" className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button key={c.v} type="button" aria-pressed={cat === c.v} onClick={() => setCat(c.v)}
              className={`chip py-1.5 ${cat === c.v ? "border-sage-600 bg-sage-700 text-white" : "border-ivory-300 bg-white text-ink-soft hover:border-sage-400"}`}>{c.l}</button>
          ))}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {!items && !error && <Loading />}
      {items && items.length === 0 && <div className="card card-pad text-sm text-ink-soft">No products match. If yours isn&rsquo;t here, you can still add it to your profile as an unverified product.</div>}
      {items && items.length > 0 && (
        <ul className="card divide-y divide-ivory-300">
          {items.map((p) => (
            <li key={p.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
              <div>
                <Link href={`/products/${p.id}`} className="font-medium text-ink">{p.variant_name}</Link>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  <Badge tone={STATUS[p.review_status]?.tone ?? "neutral"}>{STATUS[p.review_status]?.t ?? p.review_status}</Badge>
                  <Badge tone="neutral">Age: {p.age_guidance_text ? (p.field_status.age_guidance === "verified" ? p.age_guidance_text.split(" (")[0].split(";")[0] : `${p.field_status.age_guidance} on source`) : "not verified"}</Badge>
                  {p.category === "oral_care" && <Badge tone="neutral">Oral care — not nutrition</Badge>}
                  {p.allergens.length > 0 && <Badge tone="caution">Contains: {p.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ")}{p.allergen_basis !== "declared_by_manufacturer" ? " (from ingredient list)" : ""}</Badge>}
                </div>
                {p.missing.length > 0 && <p className="mt-1.5 text-xs text-ink-faint">Not verified: {p.missing.join(", ")}</p>}
              </div>
              <div className="flex gap-3 text-sm">
                <Link href={`/products/${p.id}`}>Details</Link>
                <a href={p.official_url} target="_blank" rel="noopener noreferrer">Official page ↗</a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
