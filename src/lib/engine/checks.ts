/**
 * Deterministic safety checks. These run in backend code BEFORE anything is shown
 * or sent to an LLM. They never return "safe" — the strongest positive result is
 * "no listed conflict", always paired with a label-checking reminder.
 */
import type { Allergen, ChildProfile, DietaryPattern, Product, Recipe } from "../schemas";
import { ALLERGEN_LABELS } from "../kb";

export const totalMonths = (p: Pick<ChildProfile, "age_years" | "age_months">) => p.age_years * 12 + (p.age_months ?? 0);

export function formatAge(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} month${m === 1 ? "" : "s"}`;
  if (m === 0) return `${y} year${y === 1 ? "" : "s"}`;
  return `${y} year${y === 1 ? "" : "s"} ${m} month${m === 1 ? "" : "s"}`;
}

export function formatAgeRange(min: number | null, max: number | null): string {
  const yrs = (m: number) => (m % 12 === 0 ? `${m / 12}` : `${(m / 12).toFixed(1)}`);
  if (min == null && max == null) return "not stated";
  if (max == null) return `${yrs(min!)}+ years`;
  if (min == null) return `up to ${Math.floor(max / 12)} years`;
  return `${yrs(min)}–${Math.floor(max / 12)} years`;
}

/* ---------------------------- Age ---------------------------- */

export type AgeStatus = "eligible" | "ineligible" | "unknown";
export interface AgeCheck {
  status: AgeStatus;
  message: string;
}

export function checkAge(
  min: number | null,
  max: number | null,
  months: number,
  opts: { fieldVerified?: boolean; what?: string } = {},
): AgeCheck {
  const what = opts.what ?? "This item";
  if (opts.fieldVerified === false) {
    return { status: "unknown", message: `${what}'s age guidance is not verified (missing or conflicting on the source).` };
  }
  if (min == null && max == null) return { status: "unknown", message: `${what} has no stated age range.` };
  if (min != null && months < min) return { status: "ineligible", message: `${what} is intended for ${formatAgeRange(min, max)}; your child is ${formatAge(months)}.` };
  if (max != null && months > max) return { status: "ineligible", message: `${what} is intended for ${formatAgeRange(min, max)}; your child is ${formatAge(months)}.` };
  return { status: "eligible", message: `Stated age range ${formatAgeRange(min, max)} includes your child's age.` };
}

export function productAgeCheck(product: Product, months: number): AgeCheck {
  return checkAge(product.age_min_months, product.age_max_months, months, {
    fieldVerified: product.field_status.age_guidance === "verified",
    what: product.variant_name,
  });
}

/* -------------------------- Allergens -------------------------- */

export interface AllergyContext {
  /** Canonical allergens/intolerance triggers to exclude. */
  exclude: Set<Allergen>;
  /** Free-text allergens ("other") matched by ingredient name only. */
  freeText: string[];
  hasAny: boolean;
  severe: boolean;
}

export function allergyContext(profile: ChildProfile): AllergyContext {
  const exclude = new Set<Allergen>();
  const freeText: string[] = [];
  for (const a of profile.allergies ?? []) {
    if (a.allergen === "other") {
      if (a.label) freeText.push(a.label.toLowerCase());
      continue;
    }
    exclude.add(a.allergen);
    // Conservative expansions.
    if (a.allergen === "milk") exclude.add("lactose");
    if (a.allergen === "lactose") exclude.add("milk"); // dairy foods generally contain lactose
    if (a.allergen === "gluten") exclude.add("wheat");
    if (a.allergen === "wheat") exclude.add("gluten"); // wheat-containing items are tagged gluten; oats tagged gluten too (precautionary)
  }
  return {
    exclude,
    freeText,
    hasAny: exclude.size > 0 || freeText.length > 0,
    severe: (profile.allergies ?? []).some((a) => a.severity === "severe"),
  };
}

const AVOID_SYNONYMS: Record<string, Allergen[]> = {
  egg: ["egg"], eggs: ["egg"],
  milk: ["milk", "lactose"], dairy: ["milk", "lactose"], lactose: ["lactose", "milk"],
  nut: ["tree_nut", "peanut"], nuts: ["tree_nut", "peanut"], "tree nuts": ["tree_nut"], almond: ["tree_nut"], almonds: ["tree_nut"],
  peanut: ["peanut"], peanuts: ["peanut"], groundnut: ["peanut"],
  gluten: ["gluten", "wheat"], wheat: ["wheat", "gluten"],
  soy: ["soy"], soya: ["soy"], sesame: ["sesame"], mustard: ["mustard"], fish: ["fish"],
};

/** Adds request-level "avoid X" terms to an allergy context (canonical where recognised, free text otherwise). */
export function withAvoidances(ctx: AllergyContext, avoid: string[]): AllergyContext {
  const exclude = new Set(ctx.exclude);
  const freeText = [...ctx.freeText];
  for (const raw of avoid) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    const mapped = AVOID_SYNONYMS[t];
    if (mapped) mapped.forEach((a) => exclude.add(a));
    else freeText.push(t);
  }
  return { ...ctx, exclude, freeText, hasAny: exclude.size > 0 || freeText.length > 0 };
}

export type AllergenStatus = "no_allergies_reported" | "conflict" | "cannot_confirm" | "no_listed_conflict";
export interface AllergenCheck {
  status: AllergenStatus;
  matched: string[];
  message: string;
}

export function checkAllergens(
  item: { contains: Allergen[]; ingredientNames: string[]; completeness: "complete" | "partial" | "unknown"; crossContactKnown: boolean },
  ctx: AllergyContext,
): AllergenCheck {
  if (!ctx.hasAny) {
    return { status: "no_allergies_reported", matched: [], message: "No allergies or intolerances were reported." };
  }
  const matched = new Set<string>();
  for (const a of item.contains) if (ctx.exclude.has(a)) matched.add(ALLERGEN_LABELS[a] ?? a);
  for (const term of ctx.freeText) {
    if (item.ingredientNames.some((n) => n.toLowerCase().includes(term))) matched.add(term);
  }
  if (matched.size > 0) {
    return { status: "conflict", matched: [...matched], message: `Contains ${[...matched].join(", ")}, which you listed.` };
  }
  if (item.completeness !== "complete") {
    return {
      status: "cannot_confirm",
      matched: [],
      message: "The ingredient information we hold is incomplete, so we can't check it against your child's allergies.",
    };
  }
  const freeTextNote = ctx.freeText.length ? " Allergies you typed in yourself are matched by name only." : "";
  return {
    status: "no_listed_conflict",
    matched: [],
    message: `No listed ingredient matches the allergies you entered.${freeTextNote} ${item.crossContactKnown ? "" : "Cross-contact information isn't available — "}always check the label.`.replace(/\s+/g, " ").trim(),
  };
}

export function productAllergenCheck(product: Product, ctx: AllergyContext): AllergenCheck {
  const completeness =
    product.allergen_data.basis === "declared_by_manufacturer" && product.ingredients.completeness === "complete"
      ? "complete"
      : product.ingredients.completeness;
  return checkAllergens(
    {
      contains: [...product.allergen_data.contains, ...product.allergen_data.preparation_adds],
      ingredientNames: product.ingredients.items.map((i) => i.name),
      completeness,
      crossContactKnown: !!product.allergen_data.cross_contact_info,
    },
    ctx,
  );
}

/* ---------------------------- Diet ---------------------------- */

export interface DietCheck {
  ok: boolean;
  message: string;
  omitOptional: string[];
}

export function checkDiet(recipe: Recipe, pattern: DietaryPattern): DietCheck {
  const blocked: ("egg" | "meat" | "fish")[] =
    pattern === "vegetarian" ? ["egg", "meat", "fish"] : pattern === "vegetarian_eggs" ? ["meat", "fish"] : [];
  const omit: string[] = [];
  for (const ing of recipe.ingredients) {
    const hit = ing.diet_flags.some((f) => (blocked as string[]).includes(f));
    if (!hit) continue;
    if (ing.optional) omit.push(ing.name);
    else return { ok: false, message: `Contains ${ing.name.toLowerCase()}, which doesn't fit a ${pattern.replace("_", " ")} diet.`, omitOptional: [] };
  }
  return { ok: true, message: "", omitOptional: omit };
}

/* ------------------------- Recipe allergens ------------------------- */

export function recipeAllergenCheck(recipe: Recipe, products: Product[], ctx: AllergyContext) {
  const required = recipe.ingredients.filter((i) => !i.optional);
  const optionalHits = recipe.ingredients
    .filter((i) => i.optional && (i.allergens.some((a) => ctx.exclude.has(a)) || ctx.freeText.some((t) => i.name.toLowerCase().includes(t))))
    .map((i) => i.name);
  // A recipe that includes a product inherits that product's ingredient completeness.
  let completeness: "complete" | "partial" | "unknown" = "complete";
  const contains = new Set<Allergen>(required.flatMap((i) => i.allergens));
  for (const ing of required) {
    if (!ing.product_id) continue;
    const prod = products.find((p) => p.id === ing.product_id);
    if (!prod) {
      completeness = "unknown";
      continue;
    }
    prod.allergen_data.contains.forEach((a) => contains.add(a));
    if (prod.ingredients.completeness !== "complete") completeness = "partial";
  }
  const check = checkAllergens(
    { contains: [...contains], ingredientNames: required.map((i) => i.name), completeness, crossContactKnown: false },
    ctx,
  );
  return { check, omitOptional: optionalHits };
}
