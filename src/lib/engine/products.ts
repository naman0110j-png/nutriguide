import type { ChildProfile, ConcernType, OwnedProduct, Product } from "../schemas";
import type { KnowledgeBase } from "../kb";
import { sourceById } from "../kb";
import {
  allergyContext,
  productAgeCheck,
  productAllergenCheck,
  totalMonths,
  type AgeCheck,
  type AllergenCheck,
} from "./checks";
import type { AppliedRules } from "./rules";

export interface OwnedProductInfo {
  owned: OwnedProduct;
  match: "exact_variant" | "catalogue_unverified_variant" | "external_unverified" | "not_found";
  product: Product | null;
  official_instructions: string | null;
  instructions_status: "verified" | "not_verified";
  parent_reported_routine: string | null;
  routine_note: string | null;
  age_check: AgeCheck | null;
  allergen_check: AllergenCheck | null;
  missing_fields: string[];
  conflicts: string[];
  source_url: string | null;
  source_retrieved: string | null;
}

export function missingFields(p: Product): string[] {
  return Object.entries(p.field_status)
    .filter(([, s]) => s !== "verified")
    .map(([f, s]) => `${f.replace("_", " ")} (${s})`);
}

export function resolveOwnedProducts(profile: ChildProfile, kb: KnowledgeBase): OwnedProductInfo[] {
  const months = totalMonths(profile);
  const ctx = allergyContext(profile);
  return profile.products.map((owned) => {
    const base = {
      owned,
      parent_reported_routine: owned.parent_reported_routine ?? null,
    };
    if (owned.is_external_unverified || !owned.catalog_product_id) {
      return {
        ...base,
        match: "external_unverified" as const,
        product: null,
        official_instructions: null,
        instructions_status: "not_verified" as const,
        routine_note: "We don't hold verified information for this product. Please follow its pack instructions.",
        age_check: null,
        allergen_check: null,
        missing_fields: ["all fields (product not in our verified catalogue)"],
        conflicts: [],
        source_url: null,
        source_retrieved: null,
      };
    }
    const product = kb.products.find((p) => p.id === owned.catalog_product_id && p.active) ?? null;
    if (!product) {
      return {
        ...base,
        match: "not_found" as const,
        product: null,
        official_instructions: null,
        instructions_status: "not_verified" as const,
        routine_note: "This product is no longer in our catalogue.",
        age_check: null,
        allergen_check: null,
        missing_fields: [],
        conflicts: [],
        source_url: null,
        source_retrieved: null,
      };
    }
    const verified = product.official_instructions.verified && product.field_status.instructions === "verified" && !!product.official_instructions.text;
    const src = sourceById(kb, product.source_ids[0]);
    let routineNote: string | null = null;
    if (owned.parent_reported_routine && verified) {
      routineNote =
        owned.follows_pack_instructions === "yes"
          ? "You said you follow the pack instructions."
          : "Your routine is shown next to the official instruction. If they differ, the pack instruction applies — please check with a paediatrician before changing amounts.";
    } else if (!verified) {
      routineNote = "The official instruction for this exact variant hasn't been verified in our catalogue. Please follow the pack.";
    }
    return {
      ...base,
      match: product.review_status === "approved" ? ("exact_variant" as const) : ("catalogue_unverified_variant" as const),
      product,
      official_instructions: verified ? product.official_instructions.text : null,
      instructions_status: verified ? ("verified" as const) : ("not_verified" as const),
      routine_note: routineNote,
      age_check: productAgeCheck(product, months),
      allergen_check: productAllergenCheck(product, ctx),
      missing_fields: missingFields(product),
      conflicts: product.conflicts,
      source_url: product.official_url,
      source_retrieved: src?.retrieved_at ?? product.last_fetched_at,
    };
  });
}

export interface ProductSuggestion {
  product: Product;
  rule_id: string;
  explanation: string;
  official_instructions: string;
  age_check: AgeCheck;
  allergen_check: AllergenCheck;
  limitations: string[];
  source_url: string;
}

export interface ProductSuggestionResult {
  suggestions: ProductSuggestion[];
  considered: { product_id: string; rule_id: string; excluded_because: string }[];
  suppressed_reason: string | null;
}

/**
 * Optional product information, governed entirely by reviewed rules + deterministic checks.
 * Returns an empty list whenever anything is uncertain. Never ranks by commercial value.
 */
export function eligibleProductSuggestions(
  profile: ChildProfile,
  concern: ConcernType | "general",
  kb: KnowledgeBase,
  rules: AppliedRules,
): ProductSuggestionResult {
  const considered: ProductSuggestionResult["considered"] = [];
  if (rules.blockProducts) {
    return { suggestions: [], considered, suppressed_reason: "Product information is switched off for this profile by a safety rule (see the guidance above)." };
  }
  if (concern === "general") return { suggestions: [], considered, suppressed_reason: null };
  const months = totalMonths(profile);
  const ctx = allergyContext(profile);
  const owned = new Set(profile.products.map((p) => p.catalog_product_id).filter(Boolean));
  const out: ProductSuggestion[] = [];

  for (const rule of kb.concernProductRules.filter((r) => r.concern_type === concern)) {
    const reject = (why: string) => considered.push({ product_id: rule.product_id, rule_id: rule.id, excluded_because: why });
    if (rule.review_status !== "approved") { reject(`rule ${rule.review_status}`); continue; }
    const product = kb.products.find((p) => p.id === rule.product_id);
    if (!product || !product.active) { reject("product missing or inactive"); continue; }
    if (owned.has(product.id)) { reject("already owned (shown in your products)"); continue; }
    if (product.review_status !== "approved" || !product.recommendation_eligible) { reject("product record not approved for recommendations"); continue; }
    const req = rule.eligibility_conditions.requires_assistance;
    if (req.length && !req.some((a) => profile.assistance.includes(a))) { reject("parent did not ask to learn about products"); continue; }
    const { min_age_months: rmin, max_age_months: rmax } = rule.eligibility_conditions;
    if ((rmin != null && months < rmin) || (rmax != null && months > rmax)) { reject("outside rule age range"); continue; }
    const age = productAgeCheck(product, months);
    if (age.status !== "eligible") { reject(`age ${age.status}`); continue; }
    if (!product.official_instructions.verified || !product.official_instructions.text) { reject("official instructions not verified"); continue; }
    if (rule.exclusion_conditions.allergens.some((a) => ctx.exclude.has(a))) { reject("rule allergen exclusion"); continue; }
    const statuses = profile.concerns.filter((c) => c.type === concern).map((c) => c.reported_status as string);
    if (rule.exclusion_conditions.concern_statuses.some((s) => statuses.includes(s))) { reject("concern status excluded"); continue; }
    const allergen = productAllergenCheck(product, ctx);
    if (allergen.status === "conflict") { reject("allergen conflict"); continue; }
    if (allergen.status === "cannot_confirm") { reject("ingredient data incomplete for an allergic child"); continue; }

    const limitations = [
      "Manufacturer information — not independently verified or clinically assessed.",
      ...(product.ingredients.completeness !== "complete" ? ["Full ingredient list not verified."] : []),
      ...product.conflicts,
    ];
    out.push({
      product,
      rule_id: rule.id,
      explanation: rule.parent_facing_explanation,
      official_instructions: product.official_instructions.text,
      age_check: age,
      allergen_check: allergen,
      limitations,
      source_url: product.official_url,
    });
  }
  // Deterministic, non-commercial ordering: by product id.
  out.sort((a, b) => a.product.id.localeCompare(b.product.id));
  return { suggestions: out, considered, suppressed_reason: null };
}
