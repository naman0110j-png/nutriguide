"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CONCERN_LABELS } from "@/lib/kb";
import { CONCERN_TYPES, MEAL_TYPES } from "@/lib/schemas";
import { api, ApiError, store, useProfile, useSaved } from "@/lib/client/store";
import { Badge, FeedbackButtons, Loading, Notice, Section, SourceList } from "@/components/ui";
import { NoProfile } from "@/components/NoProfile";
import { RecipeCard } from "./RecipeCard";
import { OptionalProducts, OwnedProducts } from "./ProductPanels";
import { ChatPanel } from "./ChatPanel";
import type { RecResponse } from "./types";

export function Workspace() {
  const [profile, loaded] = useProfile();
  const params = useSearchParams();
  const router = useRouter();
  const saved = useSaved();
  const concernParam = params.get("concern");
  const initialConcern = useMemo(() => {
    if (concernParam && (concernParam === "general" || (CONCERN_TYPES as readonly string[]).includes(concernParam))) return concernParam;
    return profile?.concerns[0]?.type ?? "general";
  }, [concernParam, profile]);
  const [concern, setConcern] = useState<string>(initialConcern);
  const [mealType, setMealType] = useState<string>("");
  const [maxMinutes, setMaxMinutes] = useState<string>("");
  const [avoid, setAvoid] = useState("");
  const [avoidQuery, setAvoidQuery] = useState("");
  useEffect(() => { const t = setTimeout(() => setAvoidQuery(avoid), 450); return () => clearTimeout(t); }, [avoid]);
  const [data, setData] = useState<RecResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => setConcern(initialConcern), [initialConcern]);

  useEffect(() => {
    if (!profile) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<RecResponse>("/api/recommendations", {
      body: { profile, concern, mealType: mealType || undefined, maxMinutes: maxMinutes ? Number(maxMinutes) : undefined, avoid: avoidQuery.trim() ? avoidQuery.split(",").map((s) => s.trim()).filter(Boolean) : undefined },
      signal: ctrl.signal,
    })
      .then(setData)
      .catch((e) => { if (e.name !== "AbortError") setError(e instanceof ApiError ? e.message : "We couldn't load ideas right now."); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [profile, concern, mealType, maxMinutes, avoidQuery]);

  if (!loaded) return <Loading />;
  if (!profile) return <NoProfile />;

  const profileId = store.getSavedId();
  const concernOptions = [
    ...profile.concerns.map((c) => c.type),
    ...CONCERN_TYPES.filter((c) => !profile.concerns.some((x) => x.type === c) && c !== "other"),
  ];
  const excludedByReason = data
    ? Object.entries(data.excluded.reduce<Record<string, string[]>>((acc, e) => { (acc[e.reason] ??= []).push(e.recipe_name); return acc; }, {}))
    : [];

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Food ideas</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">What would you like help with?</h1>
        <p className="mt-1 text-sm text-ink-faint">Ideas below have passed your child&rsquo;s age, diet and allergy checks. <Link href="/overview">Back to overview</Link></p>
      </header>

      <div className="card card-pad space-y-4">
        <div>
          <label htmlFor="concern" className="label">Focus</label>
          <select id="concern" className="input sm:max-w-md" value={concern} onChange={(e) => { setConcern(e.target.value); router.replace(`/workspace?concern=${e.target.value}`, { scroll: false }); }}>
            <option value="general">General food ideas</option>
            {concernOptions.map((c) => <option key={c} value={c}>{CONCERN_LABELS[c]}{profile.concerns.some((x) => x.type === c) ? " (from your profile)" : ""}</option>)}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="meal" className="label">Meal</label>
            <select id="meal" className="input" value={mealType} onChange={(e) => setMealType(e.target.value)}>
              <option value="">Any</option>
              {MEAL_TYPES.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="time" className="label">Time available</label>
            <select id="time" className="input" value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)}>
              <option value="">Any</option>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="20">20 minutes</option>
              <option value="40">40 minutes</option>
            </select>
          </div>
          <div>
            <label htmlFor="avoid" className="label">Leave out (this search only)</label>
            <input id="avoid" className="input" placeholder="e.g. egg, nuts" value={avoid} onChange={(e) => setAvoid(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <Notice tone="error" title="Couldn't load ideas">{error}</Notice>}
      {loading && !data && <Loading label="Checking ideas against your child's profile…" />}

      {data && (
        <div className={`grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <div className="min-w-0 space-y-6">
            {data.ai_notice && <p className="text-xs text-ink-faint">{data.ai_notice}</p>}
            {data.warnings.map((w) => <Notice key={w} tone="caution">{w}</Notice>)}
            {data.professional_guidance.map((g) => <Notice key={g} tone="pro" title="When to involve a professional">{g}</Notice>)}

            {data.owned_products.length > 0 && (concern === "product_question" || data.owned_products.some((o) => o.owned.wants_help.length)) && (
              <Section id="your-products" eyebrow="Products you use" title="Official instructions, side by side with your routine">
                <OwnedProducts items={data.owned_products} />
              </Section>
            )}

            <section aria-labelledby="ideas-title">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="ideas-title" className="text-2xl">{data.concern_label}</h2>
                <p className="text-xs text-ink-faint">{data.recipe_recommendations.length} idea{data.recipe_recommendations.length === 1 ? "" : "s"} · {data.excluded.length} hidden by checks</p>
              </div>
              {data.recipe_placeholder ? (
                <div className="card card-pad text-sm text-ink-soft">{data.recipe_placeholder}</div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {data.recipe_recommendations.map((c) => (
                    <RecipeCard key={c.recipe.id} card={c} explanation={c.explanation} profileId={profileId} saved={saved.has("recipe", c.recipe.id)} onSave={() => void saved.add("recipe", c.recipe.id)} />
                  ))}
                </div>
              )}
              {!saved.persistent && data.recipe_recommendations.length > 0 && <p className="mt-2 text-xs text-ink-faint">Saved ideas stay in this tab unless you chose to save your profile.</p>}
            </section>

            {data.more_recipes.length > 0 && (
              <section aria-labelledby="more-title">
                <h2 id="more-title" className="mb-3 text-xl">Other ideas that fit your child&rsquo;s profile</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {data.more_recipes.map((c) => (
                    <RecipeCard key={c.recipe.id} card={c} profileId={profileId} saved={saved.has("recipe", c.recipe.id)} onSave={() => void saved.add("recipe", c.recipe.id)} />
                  ))}
                </div>
              </section>
            )}

            {data.excluded.length > 0 && (
              <div className="card card-pad">
                <button type="button" className="text-sm font-medium text-sage-700 hover:underline" aria-expanded={showExcluded} onClick={() => setShowExcluded((s) => !s)}>
                  {showExcluded ? "Hide" : "Why"} {data.excluded.length} idea{data.excluded.length === 1 ? " is" : "s are"} hidden
                </button>
                {showExcluded && (
                  <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
                    {excludedByReason.map(([reason, names]) => <li key={reason}><strong className="text-ink">{reason}:</strong> {names.join(", ")}</li>)}
                  </ul>
                )}
              </div>
            )}

            {data.general_education.length > 0 && (
              <Section id="learn" eyebrow="General educational guidance" title="Good to know">
                <div className="space-y-5">
                  {data.general_education.map((e) => (
                    <div key={e.id}>
                      <h3 className="text-lg">{e.title}</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">{e.educational_content.map((c) => <li key={c}>{c}</li>)}</ul>
                      {e.food_guidance.length > 0 && (
                        <>
                          <p className="mt-3 text-sm font-medium">Food ideas to try</p>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-soft">{e.food_guidance.map((c) => <li key={c}>{c}</li>)}</ul>
                        </>
                      )}
                      {e.referral_conditions.length > 0 && (
                        <div className="mt-3"><Notice tone="pro">{e.referral_conditions.join(" ")}</Notice></div>
                      )}
                      {e.sources.length > 0 && <div className="mt-2 text-xs"><SourceList sources={e.sources} /></div>}
                      <div className="mt-2"><FeedbackButtons type="education" id={e.id} profileId={profileId} /></div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {(data.product_information.length > 0 || data.product_information_note) && (
              <Section id="optional-products" eyebrow="Optional" title="Product information you asked about">
                <OptionalProducts items={data.product_information} note={data.product_information_note} />
              </Section>
            )}

            {data.information_gaps.length > 0 && (
              <Section id="gaps" eyebrow="Missing information" title="What would make these ideas better">
                <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">{data.information_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
              </Section>
            )}

            <Section id="sources" eyebrow="Evidence" title="Sources used on this page">
              <SourceList sources={data.evidence_sources} />
              <div className="mt-4 flex flex-wrap gap-1.5">
                {data.applied_rules.map((r) => <Badge key={r.id} tone="neutral" title={r.id}>Rule applied: {r.name}</Badge>)}
              </div>
              <ul className="mt-4 space-y-1 text-xs text-ink-faint">{data.disclaimers.map((d) => <li key={d}>{d}</li>)}</ul>
            </Section>
          </div>

          <ChatPanel profile={profile} concern={concern} shownRecipeIds={data.recipe_recommendations.map((c) => c.recipe.id)} profileId={profileId} />
        </div>
      )}
    </div>
  );
}
