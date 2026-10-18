"use client";
import { useState } from "react";
import { ALLERGEN_LABELS } from "@/lib/kb";
import { Badge, FeedbackButtons, recipeTone, SourceList } from "@/components/ui";
import type { MoreCard } from "./types";

const allergenTone = (s: string) => (s === "conflict" ? "caution" : s === "cannot_confirm" ? "incomplete" : "neutral");

export function RecipeCard({ card, explanation, saved, onSave, profileId }: {
  card: MoreCard;
  explanation?: string;
  saved: boolean;
  onSave: () => void;
  profileId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const r = card.recipe;
  const total = r.prep_time_minutes + r.cook_time_minutes;
  const id = `recipe-${r.id}`;
  return (
    <article className="card flex flex-col overflow-hidden" aria-labelledby={`${id}-name`}>
      <div className="h-1.5 w-full bg-gradient-to-r from-sage-200 via-mist-100 to-clay-100" aria-hidden />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={recipeTone(r.review_status)}>{card.evidence_label}</Badge>
          {card.product_use && <Badge tone="official">Uses {card.product_use.product.product_family}</Badge>}
        </div>
        <h3 id={`${id}-name`} className="mt-3 text-xl leading-snug">{r.name}</h3>
        <p className="mt-1 text-sm text-ink-soft">{r.description}</p>
        <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint">
          <div><dt className="inline">Prep </dt><dd className="inline font-medium text-ink">{r.prep_time_minutes} min</dd></div>
          {r.cook_time_minutes > 0 && <div><dt className="inline">Cook </dt><dd className="inline font-medium text-ink">{r.cook_time_minutes} min</dd></div>}
          <div><dt className="inline">Difficulty </dt><dd className="inline font-medium capitalize text-ink">{r.difficulty}</dd></div>
          <div><dt className="inline">Age </dt><dd className="inline font-medium text-ink">{r.age_min_months != null ? `${Math.floor(r.age_min_months / 12)}+ yrs` : "not stated"}</dd></div>
        </dl>

        <div className="mt-4 rounded-xl bg-sage-50/70 p-3 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-sage-700">Why it may help</p>
          <p className="mt-1 text-ink">{explanation ?? card.relevance.join(" ")}</p>
          <p className="mt-1 text-xs text-ink-faint">Practical benefit, not a clinical one.</p>
        </div>

        <p className="mt-3 text-xs">
          <Badge tone={allergenTone(card.allergen_check.status)}>Allergy check</Badge>{" "}
          <span className="text-ink-soft">{card.allergen_check.message}</span>
        </p>
        {card.notes.length > 0 && <ul className="mt-2 space-y-1 text-xs text-ink-soft">{card.notes.map((n) => <li key={n}>• {n}</li>)}</ul>}

        <button type="button" className="mt-4 self-start text-sm font-medium text-sage-700 hover:underline" aria-expanded={open} aria-controls={`${id}-details`} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide recipe" : "Show ingredients & steps"}
        </button>

        {open && (
          <div id={`${id}-details`} className="mt-3 space-y-4 border-t border-ivory-300 pt-4 text-sm">
            {card.product_use && (
              <div className="rounded-xl border border-mist-300/70 bg-mist-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-mist-700">Product use · {card.product_use.label}</p>
                <p className="mt-1">{card.product_use.relation.use_description}</p>
                <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">{card.product_use.relation.usage_constraints.map((u) => <li key={u}>{u}</li>)}</ul>
                <p className="mt-1 text-xs text-ink-soft">The pack&rsquo;s official instructions still apply: <q>{card.product_use.product.official_instructions.text}</q></p>
                {card.product_use.relation.conflict_notes && <p className="mt-1 text-xs text-clay-700">Source conflict: {card.product_use.relation.conflict_notes}</p>}
              </div>
            )}
            <div>
              <h4 className="font-sans text-sm font-semibold">Ingredients</h4>
              <ul className="mt-1.5 space-y-1">
                {r.ingredients.map((i) => (
                  <li key={i.name} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{i.quantity}{i.unit ? ` ${i.unit}` : ""}</span>
                    <span>{i.name}{i.optional ? " (optional)" : ""}</span>
                    {i.allergens.map((a) => <span key={a} className="chip border-clay-200 bg-clay-50 text-clay-700">{ALLERGEN_LABELS[a]}</span>)}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-sans text-sm font-semibold">Steps</h4>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5">{r.preparation_steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </div>
            {r.substitutions.length > 0 && (
              <div>
                <h4 className="font-sans text-sm font-semibold">Alternatives & swaps</h4>
                <ul className="mt-1.5 space-y-1">{r.substitutions.map((s) => <li key={s.for}><strong>{s.for}</strong> → {s.use}{s.note ? <span className="text-ink-faint"> — {s.note}</span> : null}</li>)}</ul>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <h4 className="font-sans text-sm font-semibold">Food groups</h4>
                <p className="mt-1 text-ink-soft">{r.food_groups.join(", ")}</p>
                <p className="mt-0.5 text-xs text-ink-faint">Not nutritionally analysed — no nutrient claims are made.</p>
              </div>
              <div>
                <h4 className="font-sans text-sm font-semibold">Contains</h4>
                <p className="mt-1 text-ink-soft">{r.allergens.length ? r.allergens.map((a) => ALLERGEN_LABELS[a]).join(", ") : "None of the common allergens we track (check every label)"}</p>
              </div>
            </div>
            {r.caveats.length > 0 && (
              <div>
                <h4 className="font-sans text-sm font-semibold">Caveats</h4>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-soft">{r.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            )}
            <div>
              <h4 className="font-sans text-sm font-semibold">Source & status</h4>
              <p className="mt-1 text-xs text-ink-soft">{r.source_notes} {r.review_status !== "verified" && "Not reviewed by a nutrition professional."}</p>
              <div className="mt-1.5"><SourceList sources={card.sources} /></div>
            </div>
          </div>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
          <button type="button" className={saved ? "btn-secondary py-1.5 text-xs" : "btn-ghost py-1.5 text-xs"} onClick={onSave} aria-pressed={saved}>
            {saved ? "✓ Saved" : "Save idea"}
          </button>
          <FeedbackButtons type="recipe" id={r.id} profileId={profileId} />
        </div>
      </div>
    </article>
  );
}
