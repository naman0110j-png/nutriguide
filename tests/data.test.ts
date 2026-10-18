import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChildProfileSchema, ConcernEducationSchema, ConcernProductRuleSchema, EvidenceSourceSchema, ProductSchema, RecipeProductSchema, RecipeSchema, RecommendationRuleSchema } from "@/lib/schemas";
import { MemoryRepository } from "@/lib/repo/memory";
import { kb, profile, demo } from "./helpers";
import { runMigrationChecks } from "../scripts/test-migrations";

describe("seed integrity", () => {
  const k = kb();
  it("every record validates against its schema", () => {
    k.products.forEach((p) => ProductSchema.parse(p));
    k.recipes.forEach((r) => RecipeSchema.parse(r));
    k.recipeProducts.forEach((r) => RecipeProductSchema.parse(r));
    k.sources.forEach((s) => EvidenceSourceSchema.parse(s));
    k.education.forEach((e) => ConcernEducationSchema.parse(e));
    k.concernProductRules.forEach((r) => ConcernProductRuleSchema.parse(r));
    k.recommendationRules.forEach((r) => RecommendationRuleSchema.parse(r));
  });

  it("all cited source ids and product ids exist", () => {
    const sources = new Set(k.sources.map((s) => s.id));
    const products = new Set(k.products.map((p) => p.id));
    for (const p of k.products) p.source_ids.forEach((id) => expect(sources.has(id), `${p.id} -> ${id}`).toBe(true));
    for (const r of k.recipes) {
      r.source_ids.forEach((id) => expect(sources.has(id), `${r.id} -> ${id}`).toBe(true));
      r.ingredients.filter((i) => i.product_id).forEach((i) => expect(products.has(i.product_id!)).toBe(true));
    }
    for (const e of k.education) e.evidence_source_ids.forEach((id) => expect(sources.has(id), `${e.id} -> ${id}`).toBe(true));
    for (const r of k.concernProductRules) expect(products.has(r.product_id)).toBe(true);
  });

  it("recipe allergen lists equal the union of required-ingredient allergens", () => {
    for (const r of k.recipes) {
      const derived = new Set(r.ingredients.filter((i) => !i.optional).flatMap((i) => i.allergens));
      expect(new Set(r.allergens), r.id).toEqual(derived);
    }
  });

  it("has at least six recipes, none falsely marked verified, none with nutrient claims", () => {
    expect(k.recipes.length).toBeGreaterThanOrEqual(6);
    expect(k.recipes.filter((r) => r.review_status === "verified")).toHaveLength(0);
    for (const r of k.recipes) {
      expect(r.nutritional_information).toBeNull();
      expect(`${r.name} ${r.description} ${r.benefit_description}`).not.toMatch(/high[- ]protein|iron[- ]rich|calcium[- ]rich|rich in|high in/i);
    }
  });

  it("only approved products are recommendation-eligible, and unverified fields are never filled in", () => {
    for (const p of k.products) {
      if (p.recommendation_eligible) expect(p.review_status).toBe("approved");
      if (p.field_status.instructions !== "verified") expect(p.official_instructions.verified).toBe(false);
      if (p.official_instructions.verified) expect(p.official_instructions.source_quote).toBeTruthy();
      expect(p.official_url).toMatch(/^https:\/\/ourlittlejoys\.com\/product\//);
    }
  });

  it("nutrient reference table is empty (no validated dataset loaded)", () => {
    expect(k.nutrientReferences).toHaveLength(0);
  });
});

describe("profile validation", () => {
  it("accepts a minimal profile with optional fields skipped", () => {
    expect(() => ChildProfileSchema.parse({ age_years: 3, dietary_pattern: "vegetarian" })).not.toThrow();
  });
  it("validates age", () => {
    expect(ChildProfileSchema.safeParse({ age_years: 3, age_months: 12, dietary_pattern: "vegetarian" }).success).toBe(false);
    expect(ChildProfileSchema.safeParse({ age_years: -1, dietary_pattern: "vegetarian" }).success).toBe(false);
    expect(ChildProfileSchema.safeParse({ age_years: 19, dietary_pattern: "vegetarian" }).success).toBe(false);
    expect(ChildProfileSchema.safeParse({ age_years: 18, age_months: 1, dietary_pattern: "vegetarian" }).success).toBe(false);
  });
  it("requires a label for 'other' allergens and a description for 'other' diets", () => {
    expect(ChildProfileSchema.safeParse({ age_years: 3, dietary_pattern: "vegetarian", allergies: [{ allergen: "other" }] }).success).toBe(false);
    expect(ChildProfileSchema.safeParse({ age_years: 3, dietary_pattern: "other" }).success).toBe(false);
  });
  it("defaults consent to off", () => {
    const p = ChildProfileSchema.parse({ age_years: 3, dietary_pattern: "vegetarian" });
    expect(p.consent).toEqual({ persist: false, ai_explanations: false });
  });
});

describe("demo repository: ownership, deletion, persistence", () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ng-")), "store.json");

  it("one owner cannot read, update or delete another owner's profile", async () => {
    const repo = new MemoryRepository(tmp());
    const a = await repo.saveProfile("owner-a", demo("five-veg-nutrimix"));
    expect(await repo.getProfile("owner-b", a.id)).toBeNull();
    expect(await repo.deleteProfile("owner-b", a.id)).toBe(false);
    const hijack = await repo.saveProfile("owner-b", profile(), a.id); // id belongs to A
    expect(hijack.id).not.toBe(a.id);
    expect((await repo.getProfile("owner-a", a.id))!.profile.nickname).toBe("Demo child A");
  });

  it("allergies are saved and restored exactly", async () => {
    const file = tmp();
    const repo = new MemoryRepository(file);
    const saved = await repo.saveProfile("o", demo("three-milk-allergy"));
    const fresh = new MemoryRepository(file); // reload from disk
    const back = await fresh.getProfile("o", saved.id);
    expect(back!.profile.allergies).toEqual(demo("three-milk-allergy").allergies);
  });

  it("delete-all removes profiles and saved items and detaches feedback", async () => {
    const repo = new MemoryRepository(tmp());
    const p = await repo.saveProfile("o", profile());
    await repo.addSaved("o", { item_type: "recipe", item_id: "vegetable-poha" });
    await repo.addFeedback(p.id, { recommendation_type: "recipe", recommendation_id: "vegetable-poha", rating: "helpful", feedback_text: null });
    const r = await repo.deleteAllOwnerData("o");
    expect(r).toEqual({ profiles: 1, saved: 1 });
    expect(await repo.listProfiles("o")).toHaveLength(0);
    expect((await repo.listFeedback())[0].profile_id).toBeNull();
  });

  it("a failed write does not corrupt committed state", async () => {
    const repo = new MemoryRepository(tmp());
    const before = (await repo.getKnowledgeBase()).products.length;
    await expect(repo.upsertEntity("products", { id: "BAD ID" }, "admin")).rejects.toThrow();
    expect((await repo.getKnowledgeBase()).products.length).toBe(before);
  });

  it("status changes are validated and logged; unapproving removes eligibility", async () => {
    const repo = new MemoryRepository(tmp());
    await expect(repo.setEntityStatus("recipes", "vegetable-poha", "approved", "admin")).rejects.toThrow(/Invalid status/);
    await repo.setEntityStatus("products", "lj-nutrimix-2-6-chocolate-350g", "needs_rereview", "admin");
    const p = (await repo.getKnowledgeBase()).products.find((x) => x.id === "lj-nutrimix-2-6-chocolate-350g")!;
    expect(p.recommendation_eligible).toBe(false);
    const log = await repo.listChangeLog();
    expect(log.some((e) => e.field === "review_status" && e.new_value === "needs_rereview")).toBe(true);
  });
});

describe("database migrations (embedded PostgreSQL)", () => {
  it("apply, seed and enforce RLS", async () => {
    const results = await runMigrationChecks(() => {});
    const failed = results.filter((r) => !r.ok);
    expect(failed, JSON.stringify(failed)).toHaveLength(0);
  }, 120_000);
});
