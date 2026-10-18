import type {
  ChildProfile,
  ConcernEducation,
  ConcernType,
  EducationTopic,
  EvidenceSource,
  MealType,
  Product,
  Recipe,
  RecipeProduct,
} from "../schemas";
import type { KnowledgeBase } from "../kb";
import { CONCERN_LABELS } from "../kb";
import { allergyContext, checkAge, checkDiet, recipeAllergenCheck, totalMonths, withAvoidances, type AgeCheck, type AllergenCheck } from "./checks";
import { applyRules, factsFor, type AppliedRules } from "./rules";
import { eligibleProductSuggestions, resolveOwnedProducts, type OwnedProductInfo, type ProductSuggestion } from "./products";

export type ContentMode = "demo" | "production";

export interface RecommendationRequest {
  concern: ConcernType | "general";
  mealType?: MealType;
  maxMinutes?: number;
  /** Extra ingredients to avoid for this request (e.g. "egg"), not saved to the profile. */
  avoid?: string[];
  /** Skip the first N ranked ideas (for "show me another"). */
  offset?: number;
  contentMode: ContentMode;
}

export const EVIDENCE_LABELS: Record<string, string> = {
  verified: "Reviewed recipe",
  review_required: "Example recipe — review required",
  demo: "Demo concept — not reviewed",
  unavailable: "Incomplete — not shown",
};

export interface RecipeCard {
  recipe: Recipe;
  evidence_label: string;
  relevance: string[];
  age_check: AgeCheck;
  allergen_check: AllergenCheck;
  omit_optional: string[];
  notes: string[];
  product_use: { product: Product; relation: RecipeProduct; label: string } | null;
  sources: EvidenceSource[];
  score: number;
}

export interface Exclusion {
  recipe_id: string;
  recipe_name: string;
  reason: string;
}

export interface RecommendationResult {
  concern: ConcernType | "general";
  concern_label: string;
  age_months: number;
  content_mode: ContentMode;
  applied_rules: AppliedRules["applied"];
  warnings: string[];
  professional_guidance: string[];
  education: (ConcernEducation & { sources: EvidenceSource[] })[];
  recipes: RecipeCard[];
  more_recipes: RecipeCard[];
  excluded: Exclusion[];
  recipe_placeholder: string | null;
  owned_products: OwnedProductInfo[];
  product_suggestions: ProductSuggestion[];
  product_suggestions_note: string | null;
  information_gaps: string[];
  disclaimers: string[];
  sources: EvidenceSource[];
}

const lc = (s: string) => s.toLowerCase();
const words = (list: string[]) => list.map(lc).flatMap((s) => s.split(/[,/]| and /).map((x) => x.trim())).filter((x) => x.length > 2);

function prepLimit(profile: ChildProfile): number | null {
  switch (profile.prep_time) {
    case "5": return 5;
    case "10": return 10;
    case "20": return 20;
    default: return null;
  }
}

export function educationFor(kb: KnowledgeBase, topics: EducationTopic[]) {
  const seen = new Set<string>();
  const out: (ConcernEducation & { sources: EvidenceSource[] })[] = [];
  for (const t of topics) {
    for (const e of kb.education.filter((x) => x.concern_type === t && x.review_status === "approved")) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ ...e, sources: e.evidence_source_ids.map((id) => kb.sources.find((s) => s.id === id)).filter(Boolean) as EvidenceSource[] });
    }
  }
  return out;
}

export function recommend(profile: ChildProfile, req: RecommendationRequest, kb: KnowledgeBase): RecommendationResult {
  const months = totalMonths(profile);
  const facts = factsFor(profile, req.concern);
  const rules = applyRules(kb.recommendationRules, facts);
  const ctx = allergyContext(profile);
  // Request-level avoidances are treated as free-text exclusions.
  const reqCtx = withAvoidances(ctx, req.avoid ?? []);
  const ownedIds = new Set(profile.products.map((p) => p.catalog_product_id).filter(Boolean) as string[]);
  const likes = words(profile.likes);
  const refuses = words(profile.refuses);
  const available = words(profile.available_ingredients);
  const limit = prepLimit(profile);

  const allowedStatuses = new Set<string>(
    rules.blockUnreviewedRecipes || req.contentMode === "production" ? ["verified"] : ["verified", "review_required", "demo"],
  );

  const excluded: Exclusion[] = [];
  const cards: RecipeCard[] = [];

  for (const recipe of kb.recipes) {
    const ex = (reason: string) => excluded.push({ recipe_id: recipe.id, recipe_name: recipe.name, reason });
    if (!recipe.active) continue;
    if (!allowedStatuses.has(recipe.review_status)) {
      ex(recipe.review_status === "unavailable" ? "information incomplete" : rules.blockUnreviewedRecipes ? "not reviewed for this age group" : "not yet reviewed");
      continue;
    }
    const age = checkAge(recipe.age_min_months, recipe.age_max_months, months, { what: "This recipe" });
    if (age.status !== "eligible") { ex(age.status === "unknown" ? "age suitability unknown" : "outside its intended age range"); continue; }
    const diet = checkDiet(recipe, profile.dietary_pattern);
    if (!diet.ok) { ex("doesn't fit the dietary pattern"); continue; }
    const { check: allergen, omitOptional } = recipeAllergenCheck(recipe, kb.products, reqCtx);
    if (allergen.status === "conflict") { ex(`contains ${allergen.matched.join(", ")}`); continue; }
    if (allergen.status === "cannot_confirm" && reqCtx.hasAny) { ex("ingredient data incomplete — can't check allergies"); continue; }
    if (req.mealType && !recipe.meal_types.includes(req.mealType)) { ex(`not a ${req.mealType} idea`); continue; }
    const total = recipe.prep_time_minutes + recipe.cook_time_minutes;
    if (req.maxMinutes && total > req.maxMinutes) { ex(`takes longer than ${req.maxMinutes} minutes`); continue; }

    // Product-linked recipes: only for parents who own the exact variant, with verified instructions.
    let productUse: RecipeCard["product_use"] = null;
    const productIngs = recipe.ingredients.filter((i) => i.product_id && !i.optional);
    let productBlocked: string | null = null;
    for (const ing of productIngs) {
      const product = kb.products.find((p) => p.id === ing.product_id);
      const relation = kb.recipeProducts.find((r) => r.recipe_id === recipe.id && r.product_id === ing.product_id);
      if (!product || !relation) { productBlocked = "linked product record missing"; break; }
      if (!ownedIds.has(product.id)) { productBlocked = "uses a product you haven't listed"; break; }
      if (!product.official_instructions.verified) { productBlocked = "product instructions not verified"; break; }
      const pAge = checkAge(product.age_min_months, product.age_max_months, months, { fieldVerified: product.field_status.age_guidance === "verified" });
      if (pAge.status !== "eligible") { productBlocked = "linked product not confirmed for this age"; break; }
      if (relation.review_status === "rejected") { productBlocked = "product use rejected in review"; break; }
      if (relation.review_status !== "approved" && req.contentMode === "production") { productBlocked = "product use not yet reviewed"; break; }
      productUse = {
        product,
        relation,
        label: relation.review_status === "approved" ? "Product use reviewed" : "Product use not yet reviewed — follow the pack",
      };
    }
    if (productBlocked) { ex(productBlocked); continue; }

    // Ranking — transparent, deterministic, no commercial weighting.
    let score = 0;
    const relevance: string[] = [];
    const notes: string[] = [...diet.omitOptional.map((n) => `Leave out the optional ${n.toLowerCase()}.`), ...omitOptional.map((n) => `Leave out the optional ${n.toLowerCase()} (allergy).`)];
    if (req.concern !== "general" && recipe.concern_tags.includes(req.concern)) { score += 3; relevance.push(`Relevant to: ${CONCERN_LABELS[req.concern].toLowerCase()}.`); }
    if (req.mealType) score += 1;
    const names = recipe.ingredients.map((i) => lc(i.name)).join(" | ");
    const liked = likes.filter((w) => names.includes(w) || lc(recipe.name).includes(w));
    if (liked.length) { score += Math.min(2, liked.length); relevance.push(`Uses something your child likes: ${liked.slice(0, 2).join(", ")}.`); }
    const refused = refuses.filter((w) => names.includes(w));
    if (refused.length) { score -= 1; notes.push(`Includes ${refused.join(", ")}, which you said is often refused — it's cooked in, so this is a low-pressure way to offer it.`); }
    const have = available.filter((w) => names.includes(w));
    if (have.length) { score += 1; relevance.push(`Uses ingredients you have: ${have.slice(0, 3).join(", ")}.`); }
    if (productUse) {
      score += req.concern === "product_question" || profile.assistance.includes("recipes_with_products") ? 3 : 1;
      relevance.push(`A new way to serve ${productUse.product.product_family}, which you already use.`);
    }
    if (limit != null) {
      if (total <= limit) { score += 1; relevance.push(`Fits your ${limit}-minute window (${total} min).`); }
      else { score -= 2; notes.push(`Takes about ${total} minutes — longer than the ${limit} minutes you mentioned.`); }
    }
    const acc = profile.textures_accepted.map(lc);
    const ref = profile.textures_refused.map(lc);
    if (recipe.textures.some((t) => acc.includes(t))) { score += 1; relevance.push(`Texture your child accepts (${recipe.textures.filter((t) => acc.includes(t)).join(", ")}).`); }
    if (recipe.textures.some((t) => ref.includes(t))) score -= 1;
    if (recipe.review_status === "verified") score += 2;
    else if (recipe.review_status === "review_required") score += 1;
    if (!relevance.length) relevance.push(recipe.benefit_description);

    cards.push({
      recipe,
      evidence_label: EVIDENCE_LABELS[recipe.review_status],
      relevance,
      age_check: age,
      allergen_check: allergen,
      omit_optional: [...diet.omitOptional, ...omitOptional],
      notes,
      product_use: productUse,
      sources: recipe.source_ids.map((id) => kb.sources.find((s) => s.id === id)).filter(Boolean) as EvidenceSource[],
      score,
    });
  }

  cards.sort((a, b) => b.score - a.score || a.recipe.id.localeCompare(b.recipe.id));
  // For a specific concern, only recipes tagged for it are "recommended" — we never pad the
  // list with off-topic ideas. Other ideas that pass every check go to "more ideas".
  const tagged = req.concern === "general" ? cards : cards.filter((c) => c.recipe.concern_tags.includes(req.concern as ConcernType));
  const untagged = req.concern === "general" ? [] : cards.filter((c) => !c.recipe.concern_tags.includes(req.concern as ConcernType));
  const offset = Math.max(0, req.offset ?? 0);
  const recipes = tagged.slice(offset, offset + 3);
  const more = [...tagged.slice(offset + 3), ...untagged].slice(0, 3);

  let placeholder: string | null = null;
  if (!recipes.length) {
    placeholder = rules.blockUnreviewedRecipes
      ? "We don't yet have professionally reviewed recipe ideas for children under two, so we're not showing any. Please use the guidance below and speak to your paediatrician."
      : req.contentMode === "production"
        ? "No reviewed recipe matches this profile and request yet. We'd rather show nothing than an unreviewed suggestion."
        : "No idea in our current dataset fits every filter for this profile. Try removing a filter — we won't invent a recipe to fill the gap.";
    if (excluded.some((e) => /ingredient data incomplete/.test(e.reason)))
      placeholder += " Some ideas that use a product were hidden because that product's full ingredient list isn't verified, so we can't check it against the allergies you listed.";
    else if (excluded.some((e) => /product you haven't listed/.test(e.reason)))
      placeholder += " Some ideas use a product you haven't added to your profile.";
  }

  // Education: concern topics + rule-added topics.
  const catalog = kb.concernCatalog.find((c) => c.id === req.concern);
  const topics: EducationTopic[] = [...(catalog?.education_topics ?? []), ...rules.educationTopics];
  if (req.concern === "general") topics.unshift("limited_variety");
  const education = educationFor(kb, [...new Set(topics)]);

  const owned = resolveOwnedProducts(profile, kb);
  const suggestions = eligibleProductSuggestions(profile, req.concern, kb, rules);

  const gaps: string[] = [];
  if (!profile.meals.breakfast && !profile.meals.lunch && !profile.meals.dinner) gaps.push("Typical meals weren't described, so ideas aren't matched to your current routine.");
  if (!profile.likes.length) gaps.push("No liked foods were listed — adding a few helps us build from familiar foods.");
  if (!profile.no_known_allergies && !profile.allergies.length) gaps.push("Allergies weren't confirmed either way. If your child has any, add them so we can filter ideas.");
  if (profile.dietary_pattern === "other") gaps.push(`Your described diet ("${profile.dietary_other}") can't be applied automatically — please check each idea's ingredients.`);
  for (const o of owned) if (o.instructions_status === "not_verified") gaps.push(`Official instructions for "${o.owned.product_name}${o.owned.variant ? ` (${o.owned.variant})` : ""}" are not verified in our catalogue.`);

  const allSources = new Map<string, EvidenceSource>();
  for (const e of education) e.sources.forEach((s) => allSources.set(s.id, s));
  for (const c of [...recipes, ...more]) c.sources.forEach((s) => allSources.set(s.id, s));
  for (const o of owned) o.product?.source_ids.forEach((id) => { const s = kb.sources.find((x) => x.id === id); if (s) allSources.set(s.id, s); });
  for (const s of suggestions.suggestions) s.product.source_ids.forEach((id) => { const x = kb.sources.find((y) => y.id === id); if (x) allSources.set(x.id, x); });

  const disclaimers = [
    "Educational support only — not a diagnosis, treatment or substitute for a paediatrician or registered dietitian.",
    "Nothing here has been reviewed by a nutrition professional yet. Recipe and product labels say exactly what has and hasn't been checked.",
  ];
  if (ctx.hasAny) disclaimers.push("Allergy filtering uses the information you entered and the ingredient data we hold. It can't guarantee safety — always check labels.");

  return {
    concern: req.concern,
    concern_label: req.concern === "general" ? "General food ideas" : CONCERN_LABELS[req.concern],
    age_months: months,
    content_mode: req.contentMode,
    applied_rules: rules.applied,
    warnings: rules.warnings,
    professional_guidance: rules.professionalGuidance,
    education,
    recipes,
    more_recipes: more,
    excluded,
    recipe_placeholder: placeholder,
    owned_products: owned,
    product_suggestions: suggestions.suggestions,
    product_suggestions_note: suggestions.suppressed_reason,
    information_gaps: [...new Set(gaps)],
    disclaimers,
    sources: [...allSources.values()],
  };
}
