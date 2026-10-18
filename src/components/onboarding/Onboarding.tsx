"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChildProfileSchema, NUTRIENT_CONCERNS, type AllergyEntry, type ChildProfile, type ConcernEntry, type OwnedProduct } from "@/lib/schemas";
import { ALLERGEN_LABELS, ASSIST_LABELS, CONCERN_LABELS, DIET_LABELS, STATUS_LABELS } from "@/lib/kb";
import { api, ApiError, store } from "@/lib/client/store";
import { Choice, FieldError, Notice, TagInput } from "@/components/ui";
import { ProductPicker } from "./ProductPicker";

type Draft = Omit<Partial<ChildProfile>, "age_years" | "age_months"> & { age_years?: number | ""; age_months?: number | "" };

const STEPS = [
  { key: "child", title: "Your child", blurb: "Age, diet and allergies." },
  { key: "concerns", title: "What's on your mind", blurb: "Anything you'd like help with." },
  { key: "habits", title: "A typical day", blurb: "Rough descriptions are perfect." },
  { key: "products", title: "Products you use", blurb: "Little Joys or any other brand." },
  { key: "help", title: "How we can help", blurb: "And what we may save." },
  { key: "review", title: "Review", blurb: "Check and edit before we continue." },
] as const;

const EMPTY: Draft = {
  age_years: "",
  age_months: 0,
  allergies: [],
  likes: [],
  refuses: [],
  textures_accepted: [],
  textures_refused: [],
  concerns: [],
  meals: {},
  available_ingredients: [],
  products: [],
  assistance: [],
  consent: { persist: false, ai_explanations: false },
  no_known_allergies: false,
};

const ALLERGY_OPTIONS: { allergen: AllergyEntry["allergen"]; label: string; kind: AllergyEntry["kind"] }[] = [
  { allergen: "milk", label: "Milk (allergy)", kind: "allergy" },
  { allergen: "lactose", label: "Lactose (intolerance)", kind: "intolerance" },
  { allergen: "egg", label: "Egg", kind: "allergy" },
  { allergen: "peanut", label: "Peanut / groundnut", kind: "allergy" },
  { allergen: "tree_nut", label: "Tree nuts (almond, walnut, cashew…)", kind: "allergy" },
  { allergen: "gluten", label: "Gluten", kind: "intolerance" },
  { allergen: "wheat", label: "Wheat", kind: "allergy" },
  { allergen: "soy", label: "Soy", kind: "allergy" },
  { allergen: "sesame", label: "Sesame", kind: "allergy" },
  { allergen: "fish", label: "Fish", kind: "allergy" },
  { allergen: "shellfish", label: "Shellfish", kind: "allergy" },
  { allergen: "mustard", label: "Mustard", kind: "allergy" },
];

const CONCERN_OPTIONS = (Object.keys(CONCERN_LABELS) as ConcernEntry["type"][]).map((value) => ({ value, label: CONCERN_LABELS[value] }));

function toProfile(d: Draft): ReturnType<typeof ChildProfileSchema.safeParse> {
  return ChildProfileSchema.safeParse({
    ...d,
    age_years: d.age_years === "" ? undefined : d.age_years,
    age_months: d.age_months === "" ? 0 : d.age_months,
  });
}

export function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const existing = store.getProfile();
    const saved = store.getDraft();
    setDraft({ ...EMPTY, ...((saved ?? existing ?? {}) as Draft) });
    const s = params.get("step");
    if (s) {
      const i = STEPS.findIndex((x) => x.key === s);
      if (i >= 0) setStep(i);
    }
    setHydrated(true);
  }, [params]);

  useEffect(() => { if (hydrated) store.setDraft(draft as Partial<ChildProfile>); }, [draft, hydrated]);
  useEffect(() => { if (hydrated) headingRef.current?.focus(); }, [step, hydrated]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    // Clear errors for the field being edited (allergy/product rows share prefixes).
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([key]) => !(key === k || (k === "allergies" && key.startsWith("allergy_")) || (k === "products" && key.startsWith("product_"))))));
  };
  const months = typeof draft.age_years === "number" ? draft.age_years * 12 + (typeof draft.age_months === "number" ? draft.age_months : 0) : null;

  function validateStep(i: number): boolean {
    const e: Record<string, string> = {};
    if (STEPS[i].key === "child") {
      if (draft.age_years === "" || draft.age_years === undefined || Number.isNaN(draft.age_years)) e.age_years = "Please enter your child's age in years (0 is fine for babies).";
      else if (draft.age_years < 0 || draft.age_years > 18) e.age_years = "Age should be between 0 and 18 years.";
      if (draft.age_months !== "" && draft.age_months !== undefined && (draft.age_months < 0 || draft.age_months > 11)) e.age_months = "Months should be 0–11.";
      if (!draft.dietary_pattern) e.dietary_pattern = "Please choose the closest dietary pattern.";
      if (draft.dietary_pattern === "other" && !draft.dietary_other?.trim()) e.dietary_other = "Please describe it briefly.";
      (draft.allergies ?? []).forEach((a, idx) => { if (a.allergen === "other" && !a.label?.trim()) e[`allergy_${idx}`] = "Please name this allergen."; });
    }
    if (STEPS[i].key === "products") {
      (draft.products ?? []).forEach((p, idx) => { if (!p.brand?.trim() || !p.product_name?.trim()) e[`product_${idx}`] = "Brand and product name are needed."; });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  const next = () => { if (validateStep(step)) setStep((s) => Math.min(STEPS.length - 1, s + 1)); };
  const back = () => setStep((s) => Math.max(0, s - 1));
  const goto = (key: string) => setStep(STEPS.findIndex((s) => s.key === key));

  async function finish() {
    setSubmitError(null);
    for (let i = 0; i < STEPS.length - 1; i++) if (!validateStep(i)) { setStep(i); return; }
    const parsed = toProfile(draft);
    if (!parsed.success) {
      setSubmitError(parsed.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
      return;
    }
    const profile = { ...parsed.data, is_demo: false };
    setSubmitting(true);
    try {
      const savedId = store.getSavedId();
      if (profile.consent.persist) {
        const r = await api<{ id: string }>("/api/profiles", { body: { profile, id: savedId ?? undefined } });
        store.setSavedId(r.id);
        profile.id = r.id;
      } else if (savedId) {
        // Consent withdrawn: delete the previously saved copy.
        await api(`/api/profiles/${savedId}`, { method: "DELETE" }).catch(() => undefined);
        store.setSavedId(null);
      }
      store.setProfile(profile);
      store.setDraft(null);
      router.push("/overview");
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "Something went wrong. Your answers are still here — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!hydrated) return null;
  const S = STEPS[step];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="eyebrow">Step {step + 1} of {STEPS.length}</p>
        <div className="mt-3 flex gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Questionnaire progress">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => (i < step ? setStep(i) : undefined)}
              disabled={i > step}
              aria-label={`${s.title}${i < step ? " (completed — go back)" : i === step ? " (current)" : ""}`}
              className={`h-1.5 flex-1 rounded-full transition-colors ${i < step ? "bg-sage-600" : i === step ? "bg-sage-400" : "bg-ivory-300"}`}
            />
          ))}
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="mt-6 text-3xl outline-none sm:text-4xl">{S.title}</h1>
        <p className="mt-1 text-ink-soft">{S.blurb}</p>
      </div>

      <form className="card card-pad space-y-8" noValidate onSubmit={(e) => { e.preventDefault(); step === STEPS.length - 1 ? void finish() : next(); }}>
        {S.key === "child" && <StepChild draft={draft} set={set} errors={errors} months={months} />}
        {S.key === "concerns" && <StepConcerns draft={draft} set={set} />}
        {S.key === "habits" && <StepHabits draft={draft} set={set} />}
        {S.key === "products" && <StepProducts draft={draft} set={set} errors={errors} />}
        {S.key === "help" && <StepHelp draft={draft} set={set} />}
        {S.key === "review" && <StepReview draft={draft} goto={goto} />}

        {submitError && <Notice tone="error" title="We couldn't continue">{submitError}</Notice>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ivory-300 pt-5">
          <button type="button" className="btn-ghost" onClick={back} disabled={step === 0}>← Back</button>
          <div className="flex gap-2">
            {step > 0 && step < STEPS.length - 1 && (
              <button type="button" className="btn-ghost" onClick={() => setStep((s) => s + 1)}>Skip this step</button>
            )}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {step === STEPS.length - 1 ? (submitting ? "Saving…" : "See my overview") : "Continue"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------ Steps ------------------------------ */

type StepProps = { draft: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void };

function StepChild({ draft, set, errors, months }: StepProps & { errors: Record<string, string>; months: number | null }) {
  const allergies = draft.allergies ?? [];
  const has = (a: string) => allergies.some((x) => x.allergen === a);
  const toggle = (opt: (typeof ALLERGY_OPTIONS)[number]) => {
    set("no_known_allergies", false);
    set("allergies", has(opt.allergen) ? allergies.filter((x) => x.allergen !== opt.allergen) : [...allergies, { allergen: opt.allergen, kind: opt.kind, source: "parent_reported" } as AllergyEntry]);
  };
  const update = (i: number, patch: Partial<AllergyEntry>) => set("allergies", allergies.map((a, idx) => (idx === i ? ({ ...a, ...patch } as AllergyEntry) : a)));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_1.4fr]">
        <div>
          <label htmlFor="age_years" className="label">Age — years <span className="text-clay-600">*</span></label>
          <input id="age_years" inputMode="numeric" type="number" min={0} max={18} className="input" aria-invalid={!!errors.age_years} aria-describedby="age_years-err"
            value={draft.age_years ?? ""} onChange={(e) => set("age_years", e.target.value === "" ? "" : Number(e.target.value))} />
          <FieldError id="age_years-err" message={errors.age_years} />
        </div>
        <div>
          <label htmlFor="age_months" className="label">and months</label>
          <input id="age_months" inputMode="numeric" type="number" min={0} max={11} className="input" aria-invalid={!!errors.age_months} aria-describedby="age_months-err"
            value={draft.age_months ?? 0} onChange={(e) => set("age_months", e.target.value === "" ? "" : Number(e.target.value))} />
          <FieldError id="age_months-err" message={errors.age_months} />
        </div>
        <div>
          <label htmlFor="nickname" className="label">Nickname <span className="font-normal text-ink-faint">(optional)</span></label>
          <input id="nickname" className="input" maxLength={30} placeholder="e.g. Chhotu" value={draft.nickname ?? ""} onChange={(e) => set("nickname", e.target.value || undefined)} />
          <p className="hint">Please don&rsquo;t use your child&rsquo;s full name.</p>
        </div>
      </div>
      {months !== null && months < 24 && (
        <Notice tone="pro" title="For children under two">We&rsquo;ll share general guidance and when to involve your paediatrician, but we don&rsquo;t suggest recipes or products for under-twos yet.</Notice>
      )}
      <Choice name="gender" legend="Gender (optional)" hint="Only used if a validated reference ever needs it. You can skip this."
        options={[{ value: "girl", label: "Girl" }, { value: "boy", label: "Boy" }, { value: "another", label: "Another" }, { value: "prefer_not", label: "Prefer not to say" }]}
        value={draft.gender} onChange={(v) => set("gender", v)} />
      <div>
        <Choice name="dietary_pattern" legend="Dietary pattern *" error={errors.dietary_pattern}
          options={[
            { value: "vegetarian", label: "Vegetarian", description: "No eggs, meat or fish" },
            { value: "vegetarian_eggs", label: "Vegetarian with eggs" },
            { value: "non_vegetarian", label: "Non-vegetarian" },
            { value: "other", label: "Other", description: "Jain, vegan, etc." },
          ]}
          value={draft.dietary_pattern} onChange={(v) => set("dietary_pattern", v)} />
        {draft.dietary_pattern === "other" && (
          <div className="mt-3">
            <label htmlFor="dietary_other" className="label">Describe it briefly</label>
            <input id="dietary_other" className="input" maxLength={120} placeholder="e.g. Jain — no root vegetables" value={draft.dietary_other ?? ""} onChange={(e) => set("dietary_other", e.target.value)} aria-describedby="dietary_other-err" />
            <FieldError id="dietary_other-err" message={errors.dietary_other} />
          </div>
        )}
      </div>

      <fieldset>
        <legend className="label">Known allergies or intolerances</legend>
        <p className="hint">Only include ones you know about. Foods your child simply dislikes go further down. We never guess an allergy from what a child refuses.</p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-sage-700" checked={!!draft.no_known_allergies} onChange={(e) => { set("no_known_allergies", e.target.checked); if (e.target.checked) set("allergies", []); }} />
          No known allergies or intolerances
        </label>
        {!draft.no_known_allergies && (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {ALLERGY_OPTIONS.map((o) => (
              <label key={o.allergen} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${has(o.allergen) ? "border-sage-600 bg-sage-50" : "border-ivory-300 bg-white"}`}>
                <input type="checkbox" className="accent-sage-700" checked={has(o.allergen)} onChange={() => toggle(o)} />
                {o.label}
              </label>
            ))}
            <button type="button" className="rounded-xl border border-dashed border-ivory-300 px-3 py-2 text-left text-sm text-ink-soft hover:border-sage-400"
              onClick={() => { set("no_known_allergies", false); set("allergies", [...allergies, { allergen: "other", label: "", kind: "allergy", source: "parent_reported" } as AllergyEntry]); }}>
              + Something else
            </button>
          </div>
        )}
        {allergies.length > 0 && (
          <div className="mt-4 space-y-3">
            {allergies.map((a, i) => (
              <div key={`${a.allergen}-${i}`} className="rounded-xl border border-ivory-300 bg-white p-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  {a.allergen === "other" ? (
                    <div>
                      <label className="label" htmlFor={`al-${i}`}>Allergen</label>
                      <input id={`al-${i}`} className="input" maxLength={60} value={a.label ?? ""} onChange={(e) => update(i, { label: e.target.value })} aria-describedby={`al-${i}-err`} />
                      <FieldError id={`al-${i}-err`} message={errors[`allergy_${i}`]} />
                    </div>
                  ) : (
                    <p className="self-center text-sm font-medium">{ALLERGEN_LABELS[a.allergen]} <span className="font-normal text-ink-faint">({a.kind})</span></p>
                  )}
                  <div>
                    <label className="label" htmlFor={`sev-${i}`}>Severity <span className="font-normal text-ink-faint">(if known)</span></label>
                    <select id={`sev-${i}`} className="input" value={a.severity ?? ""} onChange={(e) => update(i, { severity: (e.target.value || undefined) as AllergyEntry["severity"] })}>
                      <option value="">Prefer not to say</option>
                      <option value="mild">Mild</option>
                      <option value="moderate">Moderate</option>
                      <option value="severe">Severe</option>
                      <option value="unknown">Not sure</option>
                    </select>
                  </div>
                  <div>
                    <label className="label" htmlFor={`rx-${i}`}>Reaction <span className="font-normal text-ink-faint">(optional)</span></label>
                    <input id={`rx-${i}`} className="input" maxLength={300} placeholder="e.g. hives" value={a.reaction_details ?? ""} onChange={(e) => update(i, { reaction_details: e.target.value || undefined })} />
                  </div>
                </div>
                <button type="button" className="mt-2 text-xs text-clay-700 hover:underline" onClick={() => set("allergies", allergies.filter((_, idx) => idx !== i))}>Remove</button>
              </div>
            ))}
            {allergies.some((a) => a.severity === "severe") && <Notice tone="caution">For severe reactions, please follow your allergist&rsquo;s plan. We&rsquo;ll switch off product suggestions and filter ideas, but you should still check every label.</Notice>}
          </div>
        )}
      </fieldset>

      <div className="grid gap-6 sm:grid-cols-2">
        <TagInput id="likes" label="Foods your child likes" value={draft.likes ?? []} onChange={(v) => set("likes", v)} suggestions={["roti", "rice", "dal", "curd", "banana", "poha", "idli", "paneer"]} />
        <TagInput id="refuses" label="Foods your child often refuses" value={draft.refuses ?? []} onChange={(v) => set("refuses", v)} suggestions={["green vegetables", "dal", "milk", "fruit", "carrot"]} />
        <TagInput id="tex_ok" label="Textures they accept" value={draft.textures_accepted ?? []} onChange={(v) => set("textures_accepted", v)} suggestions={["soft", "smooth", "crunchy", "mashed", "creamy"]} />
        <TagInput id="tex_no" label="Textures they refuse" value={draft.textures_refused ?? []} onChange={(v) => set("textures_refused", v)} suggestions={["lumpy", "stringy", "chewy", "mixed textures"]} />
      </div>
      <div>
        <label htmlFor="difficulties" className="label">Any eating difficulties you&rsquo;d like to mention? <span className="font-normal text-ink-faint">(optional)</span></label>
        <textarea id="difficulties" className="input min-h-[80px]" maxLength={500} value={draft.eating_difficulties ?? ""} onChange={(e) => set("eating_difficulties", e.target.value || undefined)} />
      </div>
    </>
  );
}

function StepConcerns({ draft, set }: StepProps) {
  const concerns = draft.concerns ?? [];
  const types = concerns.map((c) => c.type);
  const update = (type: ConcernEntry["type"], patch: Partial<ConcernEntry>) => set("concerns", concerns.map((c) => (c.type === type ? { ...c, ...patch } : c)));
  return (
    <>
      <Choice name="concerns" multi legend="Select anything you'd like help with" hint="Choose as many as you like — or none."
        options={CONCERN_OPTIONS} value={types}
        onChange={(v: ConcernEntry["type"][]) => set("concerns", v.map((t): ConcernEntry => concerns.find((c) => c.type === t) ?? { type: t, reported_status: "not_sure" }))} />
      {concerns.filter((c) => NUTRIENT_CONCERNS.includes(c.type)).map((c) => (
        <div key={c.type} className="rounded-2xl border border-mist-300/60 bg-mist-50/60 p-4">
          <p className="font-medium">{CONCERN_LABELS[c.type]}</p>
          <p className="mt-1 text-xs text-ink-soft">You don&rsquo;t need to know the answer — &ldquo;not sure&rdquo; is fine. We never treat a concern as a diagnosis.</p>
          <div className="mt-3">
            <Choice name={`status-${c.type}`} legend="Which best describes it?" value={c.reported_status} onChange={(v) => update(c.type, { reported_status: v })}
              options={[
                { value: "general_concern", label: "A general worry" },
                { value: "suspected", label: "I suspect a deficiency" },
                { value: "professional_identified", label: "A health professional raised it" },
                { value: "not_sure", label: "Not sure" },
              ]} />
          </div>
          {(c.reported_status === "professional_identified" || c.reported_status === "suspected") && (
            <div className="mt-4 space-y-3">
              <Choice name={`pro-${c.type}`} legend="Has a professional given instructions?" value={c.professional_instructions_given} onChange={(v) => update(c.type, { professional_instructions_given: v })}
                options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "not_sure", label: "Not sure" }]} />
              {c.professional_instructions_given === "yes" && (
                <div>
                  <label className="label" htmlFor={`proinst-${c.type}`}>Share them for context <span className="font-normal text-ink-faint">(optional)</span></label>
                  <textarea id={`proinst-${c.type}`} className="input min-h-[70px]" maxLength={500} value={c.professional_instructions_text ?? ""} onChange={(e) => update(c.type, { professional_instructions_text: e.target.value || undefined })} />
                  <p className="hint">For context only — their advice always takes priority, and we won&rsquo;t change or repeat any dose.</p>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {types.includes("feeding_symptom") && (
        <Notice tone="pro" title="About symptoms">If constipation has lasted more than two weeks, or comes with fever, vomiting, weight loss, blood in the stool or bloating, please contact your child&rsquo;s doctor.</Notice>
      )}
      {types.includes("product_question") && <Notice tone="info">You can add the exact product in step 4.</Notice>}
      {concerns.filter((c) => !NUTRIENT_CONCERNS.includes(c.type)).length > 0 && (
        <div>
          <label className="label" htmlFor="concern_desc">Anything you&rsquo;d like to add? <span className="font-normal text-ink-faint">(optional)</span></label>
          <textarea id="concern_desc" className="input min-h-[70px]" maxLength={500} placeholder="e.g. He gets bored of the same breakfast"
            value={concerns.find((c) => !NUTRIENT_CONCERNS.includes(c.type))?.parent_description ?? ""}
            onChange={(e) => { const first = concerns.find((c) => !NUTRIENT_CONCERNS.includes(c.type))!; update(first.type, { parent_description: e.target.value || undefined }); }} />
        </div>
      )}
    </>
  );
}

function StepHabits({ draft, set }: StepProps) {
  const meals = draft.meals ?? {};
  const setMeal = (k: keyof NonNullable<Draft["meals"]>, v: string) => set("meals", { ...meals, [k]: v || undefined });
  return (
    <>
      <p className="text-sm text-ink-soft">Approximate is perfect. No need to weigh anything or count calories.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {([["breakfast", "Typical breakfast", "e.g. poha, or milk and toast"], ["lunch", "Typical lunch", "e.g. dal rice"], ["dinner", "Typical dinner", "e.g. roti, sabzi"], ["snacks", "Snacks", "e.g. fruit, biscuits"], ["beverages", "Milk and other drinks", "e.g. milk twice a day"]] as const).map(([k, l, ph]) => (
          <div key={k}>
            <label className="label" htmlFor={`meal-${k}`}>{l}</label>
            <input id={`meal-${k}`} className="input" maxLength={300} placeholder={ph} value={meals[k] ?? ""} onChange={(e) => setMeal(k, e.target.value)} />
          </div>
        ))}
      </div>
      <Choice name="eats_outside" legend="Does your child eat at school or daycare?" value={draft.eats_outside} onChange={(v) => set("eats_outside", v)}
        options={[{ value: "school", label: "School" }, { value: "daycare", label: "Daycare" }, { value: "both", label: "Both" }, { value: "no", label: "No" }]} />
      <Choice name="prep_time" legend="Time you usually have to prepare food" value={draft.prep_time} onChange={(v) => set("prep_time", v)}
        options={[{ value: "5", label: "About 5 minutes" }, { value: "10", label: "About 10 minutes" }, { value: "20", label: "About 20 minutes" }, { value: "30plus", label: "30 minutes or more" }]} />
      <Choice name="complexity" legend="Cooking you're comfortable with" value={draft.cooking_complexity} onChange={(v) => set("cooking_complexity", v)}
        options={[{ value: "very_simple", label: "Very simple / no-cook" }, { value: "simple", label: "Simple" }, { value: "happy_to_cook", label: "Happy to cook" }]} />
      <TagInput id="available" label="Ingredients you usually have at home (optional)" value={draft.available_ingredients ?? []} onChange={(v) => set("available_ingredients", v)} suggestions={["oats", "besan", "ragi flour", "curd", "banana", "paneer", "poha", "moong dal"]} />
    </>
  );
}

function StepProducts({ draft, set, errors }: StepProps & { errors: Record<string, string> }) {
  const products = draft.products ?? [];
  const update = (i: number, patch: Partial<OwnedProduct>) => set("products", products.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  return (
    <>
      <p className="text-sm text-ink-soft">Optional. Adding the <strong>exact variant</strong> lets us show its official instructions. We never treat your routine as the official instruction.</p>
      <ProductPicker onAdd={(p) => set("products", [...products, p])} existingIds={products.map((p) => p.catalog_product_id).filter(Boolean) as string[]} />
      {products.map((p, i) => (
        <div key={i} className="rounded-2xl border border-ivory-300 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-medium">{p.brand} {p.product_name}{p.variant ? ` · ${p.variant}` : ""}{p.age_variant ? ` · ${p.age_variant}` : ""}</p>
              <p className="text-xs text-ink-faint">{p.is_external_unverified ? "Not in our verified catalogue — we can't show official instructions for it" : "Matched to a catalogue variant"}</p>
            </div>
            <button type="button" className="text-xs text-clay-700 hover:underline" onClick={() => set("products", products.filter((_, idx) => idx !== i))}>Remove</button>
          </div>
          {p.is_external_unverified && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div><label className="label" htmlFor={`pb-${i}`}>Brand</label><input id={`pb-${i}`} className="input" value={p.brand} onChange={(e) => update(i, { brand: e.target.value })} /></div>
              <div><label className="label" htmlFor={`pn-${i}`}>Product name</label><input id={`pn-${i}`} className="input" value={p.product_name} onChange={(e) => update(i, { product_name: e.target.value })} /></div>
              <div><label className="label" htmlFor={`pv-${i}`}>Variant / flavour</label><input id={`pv-${i}`} className="input" value={p.variant ?? ""} onChange={(e) => update(i, { variant: e.target.value || undefined })} /></div>
            </div>
          )}
          <FieldError id={`p-${i}-err`} message={errors[`product_${i}`]} />
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor={`pf-${i}`}>How often, roughly?</label><input id={`pf-${i}`} className="input" placeholder="e.g. once a day" value={p.frequency ?? ""} onChange={(e) => update(i, { frequency: e.target.value || undefined })} /></div>
            <div><label className="label" htmlFor={`pr-${i}`}>How you use it now</label><input id={`pr-${i}`} className="input" placeholder="e.g. 1 scoop in warm milk" value={p.parent_reported_routine ?? ""} onChange={(e) => update(i, { parent_reported_routine: e.target.value || undefined })} /></div>
          </div>
          <div className="mt-3">
            <Choice name={`follows-${i}`} legend="Do you follow the pack instructions?" value={p.follows_pack_instructions} onChange={(v) => update(i, { follows_pack_instructions: v })}
              options={[{ value: "yes", label: "Yes" }, { value: "no", label: "Not exactly" }, { value: "not_sure", label: "Not sure" }]} />
          </div>
          <div className="mt-3"><label className="label" htmlFor={`pd-${i}`}>Any difficulties or questions?</label><input id={`pd-${i}`} className="input" maxLength={500} placeholder="e.g. he gets bored of it" value={p.difficulties ?? ""} onChange={(e) => update(i, { difficulties: e.target.value || undefined })} /></div>
          <div className="mt-3">
            <Choice name={`help-${i}`} multi legend="Would you like help with…" value={p.wants_help} onChange={(v) => update(i, { wants_help: v })}
              options={[{ value: "using", label: "Ways to use it" }, { value: "label", label: "Understanding the label" }, { value: "alternatives", label: "Food alternatives" }]} />
          </div>
        </div>
      ))}
    </>
  );
}

function StepHelp({ draft, set }: StepProps) {
  const consent = draft.consent ?? { persist: false, ai_explanations: false };
  return (
    <>
      <Choice name="assistance" multi legend="What would help most?" value={draft.assistance ?? []} onChange={(v) => set("assistance", v)}
        options={(Object.keys(ASSIST_LABELS) as (keyof typeof ASSIST_LABELS)[]).map((k) => ({
          value: k as NonNullable<Draft["assistance"]>[number],
          label: ASSIST_LABELS[k].charAt(0).toUpperCase() + ASSIST_LABELS[k].slice(1),
          description: k === "learn_products" ? "Optional. Products only appear when every age, allergy and data check passes." : undefined,
        }))} />
      {draft.assistance?.includes("other") && (
        <div><label className="label" htmlFor="assist_other">Tell us more</label><input id="assist_other" className="input" maxLength={300} value={draft.assistance_other ?? ""} onChange={(e) => set("assistance_other", e.target.value || undefined)} /></div>
      )}
      <fieldset className="space-y-3 rounded-2xl border border-ivory-300 bg-ivory-100 p-4">
        <legend className="label px-1">Your data</legend>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 accent-sage-700" checked={consent.persist} onChange={(e) => set("consent", { ...consent, persist: e.target.checked })} />
          <span><strong>Save this profile</strong> so I can come back to it in this browser. <span className="block text-xs text-ink-faint">Off by default. If off, your answers stay in this browser tab only and disappear when you close it. You can delete saved data at any time from the Privacy page.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 accent-sage-700" checked={consent.ai_explanations} onChange={(e) => set("consent", { ...consent, ai_explanations: e.target.checked })} />
          <span><strong>Allow AI-written explanations.</strong> <span className="block text-xs text-ink-faint">If an AI provider is configured, de-identified details (age, diet, allergy types, concerns, likes — never the nickname or anything you typed in the free-text boxes) are sent to it to word the explanations. Recipes, products and safety checks are always decided by fixed rules, not the AI.</span></span>
        </label>
      </fieldset>
    </>
  );
}

function StepReview({ draft, goto }: { draft: Draft; goto: (k: string) => void }) {
  const rows = useMemo(() => {
    const age = typeof draft.age_years === "number" ? `${draft.age_years} y ${draft.age_months || 0} m` : "—";
    return [
      { step: "child", label: "Age", value: age },
      { step: "child", label: "Diet", value: draft.dietary_pattern ? (draft.dietary_pattern === "other" ? draft.dietary_other ?? "Other" : DIET_LABELS[draft.dietary_pattern]) : "—" },
      { step: "child", label: "Allergies", value: draft.no_known_allergies ? "None known" : (draft.allergies ?? []).map((a) => (a.allergen === "other" ? a.label : ALLERGEN_LABELS[a.allergen]) + (a.severity ? ` (${a.severity})` : "")).join(", ") || "Not stated" },
      { step: "child", label: "Likes / refuses", value: `${(draft.likes ?? []).join(", ") || "—"} / ${(draft.refuses ?? []).join(", ") || "—"}` },
      { step: "concerns", label: "Concerns", value: (draft.concerns ?? []).map((c) => `${CONCERN_LABELS[c.type]}${NUTRIENT_CONCERNS.includes(c.type) ? ` (${STATUS_LABELS[c.reported_status]})` : ""}`).join("; ") || "None selected" },
      { step: "habits", label: "Typical day", value: Object.entries(draft.meals ?? {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Not described" },
      { step: "habits", label: "Prep time", value: draft.prep_time ? `${draft.prep_time === "30plus" ? "30+" : draft.prep_time} minutes` : "—" },
      { step: "products", label: "Products", value: (draft.products ?? []).map((p) => `${p.brand} ${p.product_name}${p.variant ? ` (${p.variant})` : ""}`).join("; ") || "None" },
      { step: "help", label: "Help wanted", value: (draft.assistance ?? []).map((a) => ASSIST_LABELS[a]).join("; ") || "—" },
      { step: "help", label: "Saving", value: draft.consent?.persist ? "Save this profile" : "This tab only (not saved)" },
      { step: "help", label: "AI explanations", value: draft.consent?.ai_explanations ? "Allowed" : "Off" },
    ];
  }, [draft]);
  return (
    <dl className="divide-y divide-ivory-300">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[8rem_1fr_auto] items-baseline gap-3 py-3 text-sm">
          <dt className="text-ink-faint">{r.label}</dt>
          <dd className="text-ink">{r.value}</dd>
          <button type="button" className="text-xs text-sage-700 hover:underline" onClick={() => goto(r.step)} aria-label={`Edit ${r.label}`}>Edit</button>
        </div>
      ))}
    </dl>
  );
}
