import { describe, expect, it } from "vitest";
import { recommend } from "@/lib/engine/recommend";
import { buildOverview } from "@/lib/engine/overview";
import { resolveOwnedProducts, eligibleProductSuggestions } from "@/lib/engine/products";
import { applyRules, factsFor } from "@/lib/engine/rules";
import { checkAge, allergyContext, productAllergenCheck } from "@/lib/engine/checks";
import { kb, profile, demo, NUTRIMIX_2_6, ownsNutrimix } from "./helpers";

const ids = (r: ReturnType<typeof recommend>) => r.recipes.map((c) => c.recipe.id);

describe("recipe retrieval", () => {
  it("retrieves recipes relevant to the selected concern", () => {
    const r = recommend(profile(), { concern: "iron", contentMode: "demo" }, kb());
    expect(r.recipes.length).toBeGreaterThan(0);
    expect(r.recipes.length).toBeLessThanOrEqual(3);
    for (const c of r.recipes) expect(c.recipe.concern_tags).toContain("iron");
  });

  it("does not pad a concern with off-topic recipes to reach three", () => {
    const r = recommend(profile(), { concern: "vitamin_d", contentMode: "demo" }, kb());
    expect(r.recipes).toHaveLength(0); // no recipe is tagged vitamin_d
    expect(r.recipe_placeholder).toBeTruthy();
  });

  it("excludes recipes outside the age range", () => {
    const r = recommend(profile({ age_years: 1, age_months: 10 }), { concern: "picky_eating", contentMode: "demo" }, kb());
    expect(r.recipes).toHaveLength(0);
  });

  it("excludes egg recipes for a vegetarian child but keeps them for vegetarian_eggs", () => {
    const veg = recommend(profile({ dietary_pattern: "vegetarian" }), { concern: "protein_foods", contentMode: "demo" }, kb());
    expect([...ids(veg), ...veg.more_recipes.map((c) => c.recipe.id)]).not.toContain("egg-bhurji-roti");
    expect(veg.excluded.find((e) => e.recipe_id === "egg-bhurji-roti")?.reason).toMatch(/dietary/);
    const eggs = recommend(profile({ dietary_pattern: "vegetarian_eggs" }), { concern: "protein_foods", contentMode: "demo" }, kb());
    expect(eggs.excluded.find((e) => e.recipe_id === "egg-bhurji-roti")).toBeUndefined();
  });

  it("filters by preparation time and meal type", () => {
    const r = recommend(profile(), { concern: "general", maxMinutes: 5, contentMode: "demo" }, kb());
    for (const c of [...r.recipes, ...r.more_recipes]) expect(c.recipe.prep_time_minutes + c.recipe.cook_time_minutes).toBeLessThanOrEqual(5);
    const b = recommend(profile(), { concern: "general", mealType: "dinner", contentMode: "demo" }, kb());
    for (const c of b.recipes) expect(c.recipe.meal_types).toContain("dinner");
  });

  it("production mode shows only verified recipes (none yet) and says so", () => {
    const r = recommend(profile(), { concern: "picky_eating", contentMode: "production" }, kb());
    expect(r.recipes).toHaveLength(0);
    expect(r.recipe_placeholder).toMatch(/reviewed/i);
  });

  it("labels every recipe with its evidence status", () => {
    const r = recommend(profile(), { concern: "general", contentMode: "demo" }, kb());
    for (const c of r.recipes) expect(c.evidence_label).toMatch(/review|Demo|Reviewed/);
  });
});

describe("allergen safeguards", () => {
  it("known allergens trigger exclusion (milk)", () => {
    const p = profile({ no_known_allergies: false, allergies: [{ allergen: "milk", kind: "allergy", source: "parent_reported" }] });
    const r = recommend(p, { concern: "calcium", contentMode: "demo" }, kb());
    for (const c of [...r.recipes, ...r.more_recipes]) expect(c.recipe.allergens).not.toContain("milk");
    expect(r.excluded.some((e) => /milk/.test(e.reason))).toBe(true);
  });

  it("optional allergen ingredients do not exclude the recipe but are flagged to omit", () => {
    const p = profile({ no_known_allergies: false, allergies: [{ allergen: "peanut", kind: "allergy", source: "parent_reported" }] });
    const r = recommend(p, { concern: "fruit_veg", contentMode: "demo" }, kb());
    const poha = [...r.recipes, ...r.more_recipes].find((c) => c.recipe.id === "vegetable-poha");
    expect(poha).toBeDefined();
    expect(poha!.omit_optional.join(" ")).toMatch(/peanut/i);
  });

  it("free-text allergies are matched by ingredient name", () => {
    const p = profile({ no_known_allergies: false, allergies: [{ allergen: "other", label: "besan", kind: "allergy", source: "parent_reported" }] });
    const r = recommend(p, { concern: "fruit_veg", contentMode: "demo" }, kb());
    expect([...ids(r), ...r.more_recipes.map((c) => c.recipe.id)]).not.toContain("besan-veg-cheela");
  });

  it("incomplete ingredient data prevents any safety claim for an allergic child", () => {
    const k = kb();
    const nutrimix = k.products.find((p) => p.id === NUTRIMIX_2_6)!;
    const ctx = allergyContext(profile({ no_known_allergies: false, allergies: [{ allergen: "sesame", kind: "allergy", source: "parent_reported" }] }));
    const check = productAllergenCheck(nutrimix, ctx);
    expect(check.status).toBe("cannot_confirm");
    expect(check.message).not.toMatch(/safe/i);
  });

  it("a complete ingredient list yields 'no listed conflict', never 'safe'", () => {
    const k = kb();
    const fills = k.products.find((p) => p.id === "lj-millet-choco-fills-250g")!;
    const ok = productAllergenCheck(fills, allergyContext(profile({ no_known_allergies: false, allergies: [{ allergen: "sesame", kind: "allergy", source: "parent_reported" }] })));
    expect(ok.status).toBe("no_listed_conflict");
    expect(ok.message).toMatch(/check the label/i);
    expect(ok.message).not.toMatch(/\bsafe\b/i);
    const bad = productAllergenCheck(fills, allergyContext(profile({ no_known_allergies: false, allergies: [{ allergen: "peanut", kind: "allergy", source: "parent_reported" }] })));
    expect(bad.status).toBe("conflict");
  });

  it("lactose-free Nutrimix is flagged for a milk-allergic child (lactose-free ≠ milk-free)", () => {
    const k = kb();
    const lf = k.products.find((p) => p.id === "lj-nutrimix-lactose-free-350g")!;
    const check = productAllergenCheck(lf, allergyContext(profile({ no_known_allergies: false, allergies: [{ allergen: "milk", kind: "allergy", source: "parent_reported" }] })));
    expect(check.status).toBe("conflict");
  });

  it("product-linked recipes are excluded for allergic children when product data is incomplete", () => {
    const p = profile({ ...ownsNutrimix, no_known_allergies: false, allergies: [{ allergen: "sesame", kind: "allergy", source: "parent_reported" }] });
    const r = recommend(p, { concern: "product_question", contentMode: "demo" }, kb());
    expect(ids(r)).not.toContain("nutrimix-banana-smoothie");
    expect(r.excluded.find((e) => e.recipe_id === "nutrimix-banana-smoothie")?.reason).toMatch(/incomplete/);
  });
});

describe("products: exact variants, age, rules", () => {
  it("matches the exact owned variant and shows its verified official instruction", () => {
    const owned = resolveOwnedProducts(profile(ownsNutrimix), kb());
    expect(owned[0].match).toBe("exact_variant");
    expect(owned[0].official_instructions).toMatch(/2 scoops \(30 g\).*200 ml/);
  });

  it("never reuses another variant's instruction for an unverified variant", () => {
    const p = profile({ products: [{ catalog_product_id: "lj-nutrimix-2-6-strawberry", is_external_unverified: false, brand: "Little Joys", product_name: "Nutrimix", variant: "Strawberry", follows_pack_instructions: "not_sure", wants_help: [] }] });
    const owned = resolveOwnedProducts(p, kb());
    expect(owned[0].official_instructions).toBeNull();
    expect(owned[0].instructions_status).toBe("not_verified");
  });

  it("parent-reported routine is kept separate from the official instruction", () => {
    const p = profile({ products: [{ ...ownsNutrimix.products[0], parent_reported_routine: "1 scoop in hot milk" }] });
    const owned = resolveOwnedProducts(p, kb())[0];
    expect(owned.parent_reported_routine).toBe("1 scoop in hot milk");
    expect(owned.official_instructions).not.toContain("1 scoop in hot milk");
  });

  it("product-linked recipes only appear for families who own the exact product", () => {
    const without = recommend(profile(), { concern: "product_question", contentMode: "demo" }, kb());
    expect(ids(without)).not.toContain("nutrimix-banana-smoothie");
    const withP = recommend(profile(ownsNutrimix), { concern: "product_question", contentMode: "demo" }, kb());
    expect(ids(withP)).toContain("nutrimix-banana-smoothie");
    const card = withP.recipes.find((c) => c.recipe.id === "nutrimix-banana-smoothie")!;
    expect(card.product_use?.label).toMatch(/not yet reviewed/i);
  });

  it("product-linked recipes are hidden when the child is outside the product's age band", () => {
    const r = recommend(profile({ ...ownsNutrimix, age_years: 8 }), { concern: "product_question", contentMode: "demo" }, kb());
    expect(ids(r)).not.toContain("nutrimix-banana-smoothie");
    const owned = r.owned_products[0];
    expect(owned.age_check?.status).toBe("ineligible");
  });

  it("age-ineligible products are not suggested", () => {
    const p = profile({ age_years: 9, assistance: ["learn_products"] });
    const r = eligibleProductSuggestions(p, "protein_foods", kb(), applyRules(kb().recommendationRules, factsFor(p)));
    expect(r.suggestions).toHaveLength(0);
  });

  it("an approved rule + all checks passing yields optional product information with an explanation", () => {
    const p = profile({ age_years: 4, assistance: ["learn_products"], concerns: [{ type: "protein_foods", reported_status: "general_concern" }] });
    const r = recommend(p, { concern: "protein_foods", contentMode: "demo" }, kb());
    expect(r.product_suggestions.map((s) => s.product.id)).toEqual([NUTRIMIX_2_6]);
    expect(r.product_suggestions[0].explanation).toMatch(/not a recommendation/i);
    expect(r.product_suggestions[0].official_instructions).toMatch(/2 scoops/);
  });

  it("no product is shown unless the parent asked to learn about products", () => {
    const p = profile({ age_years: 4, assistance: ["picky_alternatives"] });
    expect(recommend(p, { concern: "protein_foods", contentMode: "demo" }, kb()).product_suggestions).toHaveLength(0);
  });

  it("unreviewed and rejected concern-product relationships never produce suggestions", () => {
    const p = profile({ age_years: 5, assistance: ["learn_products"], concerns: [{ type: "calcium", reported_status: "general_concern" }, { type: "picky_eating", reported_status: "general_concern" }] });
    const calcium = recommend(p, { concern: "calcium", contentMode: "demo" }, kb());
    expect(calcium.product_suggestions).toHaveLength(0);
    const picky = recommend(p, { concern: "picky_eating", contentMode: "demo" }, kb());
    expect(picky.product_suggestions).toHaveLength(0); // multivitamin rule is rejected
  });

  it("a suspected deficiency blocks product suggestions and adds referral guidance", () => {
    const p = profile({ age_years: 4, assistance: ["learn_products"], concerns: [{ type: "calcium", reported_status: "suspected" }, { type: "protein_foods", reported_status: "general_concern" }] });
    const r = recommend(p, { concern: "protein_foods", contentMode: "demo" }, kb());
    expect(r.product_suggestions).toHaveLength(0);
    expect(r.product_suggestions_note).toMatch(/switched off/);
    expect(r.professional_guidance.join(" ")).toMatch(/qualified professional/);
  });

  it("an allergy listed in a rule's exclusions removes the suggestion", () => {
    const p = profile({ age_years: 4, assistance: ["learn_products"], no_known_allergies: false, allergies: [{ allergen: "tree_nut", kind: "allergy", source: "parent_reported" }] });
    expect(recommend(p, { concern: "protein_foods", contentMode: "demo" }, kb()).product_suggestions).toHaveLength(0);
  });

  it("picky eating never triggers product suggestions", () => {
    for (const d of ["five-veg-nutrimix", "three-milk-allergy"]) {
      const r = recommend(demo(d), { concern: "picky_eating", contentMode: "demo" }, kb());
      expect(r.product_suggestions).toHaveLength(0);
    }
  });
});

describe("under-two safeguard", () => {
  it("shows guidance, no recipes and no products", () => {
    const r = recommend(demo("toddler-iron"), { concern: "iron", contentMode: "demo" }, kb());
    expect(r.recipes).toHaveLength(0);
    expect(r.product_suggestions).toHaveLength(0);
    expect(r.education.map((e) => e.concern_type)).toContain("under_two");
    expect(r.applied_rules.map((x) => x.id)).toContain("rule-under-two");
  });
});

describe("overview", () => {
  it("summarises only what the parent entered", () => {
    const o = buildOverview(demo("five-veg-nutrimix"), kb());
    expect(o.summary).toMatch(/5 years 2 months/);
    expect(o.summary).toMatch(/vegetarian/);
    expect(o.summary).toMatch(/green vegetables/);
    expect(o.summary).toMatch(/Nutrimix/);
    expect(o.summary).not.toMatch(/deficien/i);
  });

  it("labels fact sources and separates parent-reported from verified product facts", () => {
    const o = buildOverview(demo("five-veg-nutrimix"), kb());
    expect(o.known.some((k) => k.source === "parent_reported" && /routine/i.test(k.label))).toBe(true);
    expect(o.known.some((k) => k.source === "verified_product" && /Official instruction/.test(k.label))).toBe(true);
  });

  it("keeps nutrient concerns as parent-reported and lists what cannot be determined", () => {
    const o = buildOverview(demo("three-milk-allergy"), kb());
    const calcium = o.concerns.find((c) => c.type === "calcium")!;
    expect(calcium.status).toMatch(/Parent-reported/);
    expect(calcium.status).toMatch(/not clinically assessed/);
    expect(o.cannot_determine.join(" ")).toMatch(/deficiency/);
    expect(o.calculations_note).toMatch(/No calculations/);
  });

  it("never presents a product as the default next action", () => {
    for (const d of ["five-veg-nutrimix", "three-milk-allergy", "toddler-iron"]) {
      const o = buildOverview(demo(d), kb());
      expect(o.next_actions[0].label).toMatch(/food ideas/i);
      expect(o.next_actions.map((a) => a.label).join(" ")).not.toMatch(/buy|purchase|shop/i);
    }
  });
});

describe("age check", () => {
  it("treats unverified/conflicting age guidance as unknown", () => {
    expect(checkAge(48, 83, 60, { fieldVerified: false }).status).toBe("unknown");
    expect(checkAge(null, null, 60).status).toBe("unknown");
    expect(checkAge(24, 83, 23).status).toBe("ineligible");
    expect(checkAge(24, 83, 83).status).toBe("eligible");
    expect(checkAge(24, 83, 84).status).toBe("ineligible");
  });
});
