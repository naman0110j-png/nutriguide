"use client";
import Link from "next/link";
import { Badge } from "@/components/ui";
import type { OwnedInfo, ProductInfo } from "./types";

const ageTone = (s?: string) => (s === "eligible" ? "reviewed" : s === "ineligible" ? "caution" : "incomplete");

export function OwnedProducts({ items }: { items: OwnedInfo[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-4">
      {items.map((o, i) => (
        <div key={i} className="rounded-2xl border border-mist-300/60 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{o.product?.variant_name ?? `${o.owned.brand} ${o.owned.product_name}${o.owned.variant ? ` · ${o.owned.variant}` : ""}`}</p>
              <p className="text-xs text-ink-faint">
                {o.match === "exact_variant" ? "Matched to this exact variant" : o.match === "catalogue_unverified_variant" ? "In our catalogue, but key details aren't verified yet" : o.match === "external_unverified" ? "Not in our verified catalogue" : "Not found"}
              </p>
            </div>
            {o.product && <Link href={`/products/${o.product.id}`} className="text-xs">Product details →</Link>}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-mist-50 p-3">
              <Badge tone="official">Official instruction</Badge>
              {o.official_instructions ? (
                <p className="mt-2 text-sm"><q>{o.official_instructions}</q></p>
              ) : (
                <p className="mt-2 text-sm text-ink-soft">Not verified for this exact variant. Please follow the pack.</p>
              )}
              {o.source_url && <p className="mt-1 text-xs text-ink-faint"><a href={o.source_url} target="_blank" rel="noopener noreferrer">Official page</a>{o.source_retrieved ? ` · retrieved ${String(o.source_retrieved).slice(0, 10)}` : ""}</p>}
            </div>
            <div className="rounded-xl bg-ivory-100 p-3">
              <Badge tone="parent">Your routine (as you told us)</Badge>
              <p className="mt-2 text-sm">{o.parent_reported_routine ?? <span className="text-ink-soft">Not described.</span>}</p>
            </div>
          </div>
          {o.explanation && <p className="mt-3 text-sm text-ink-soft">{o.explanation}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {o.age_check && <span className="flex items-center gap-1"><Badge tone={ageTone(o.age_check.status)}>Age</Badge> <span className="text-ink-soft">{o.age_check.message}</span></span>}
          </div>
          {o.allergen_check && o.allergen_check.status !== "no_allergies_reported" && <p className="mt-1 text-xs text-ink-soft"><Badge tone={o.allergen_check.status === "conflict" ? "caution" : "incomplete"}>Allergy check</Badge> {o.allergen_check.message}</p>}
          {o.conflicts.length > 0 && <ul className="mt-2 space-y-1 text-xs text-clay-700">{o.conflicts.map((c) => <li key={c}>Source conflict: {c}</li>)}</ul>}
          {o.missing_fields.length > 0 && <p className="mt-2 text-xs text-ink-faint">Not verified in our record: {o.missing_fields.join(", ")}.</p>}
        </div>
      ))}
    </div>
  );
}

export function OptionalProducts({ items, note }: { items: ProductInfo[]; note: string | null }) {
  if (!items.length && !note) return null;
  return (
    <div className="space-y-3">
      {note && <p className="text-sm text-ink-soft">{note}</p>}
      {items.map((s) => (
        <div key={s.product.id} className="rounded-2xl border border-ivory-300 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="official">Optional · manufacturer information</Badge>
            <Badge tone="neutral">Not a recommendation to buy</Badge>
          </div>
          <p className="mt-2 font-medium">{s.product.variant_name}</p>
          <p className="mt-1 text-sm text-ink-soft">{s.explanation}</p>
          <p className="mt-2 text-sm"><span className="text-ink-faint">Official instruction: </span><q>{s.official_instructions}</q></p>
          <p className="mt-1 text-xs text-ink-soft">{s.age_check.message} · {s.allergen_check.message}</p>
          <ul className="mt-2 list-disc pl-5 text-xs text-ink-faint">{s.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="mt-2 text-xs"><Link href={`/products/${s.product.id}`}>Details & sources</Link> · <a href={s.source_url} target="_blank" rel="noopener noreferrer">Official page</a></p>
        </div>
      ))}
    </div>
  );
}
