import { SOURCES } from "./sources";
import { PRODUCTS } from "./products";
import { RECIPES, RECIPE_PRODUCTS } from "./recipes";
import { CONCERN_CATALOG, CONCERN_EDUCATION, CONCERN_PRODUCT_RULES, RECOMMENDATION_RULES, NUTRIENT_REFERENCES } from "./knowledge";
import type { KnowledgeBase } from "@/lib/kb";

export function seedKnowledgeBase(): KnowledgeBase {
  // Deep clone so callers can never mutate the seed module.
  return structuredClone({
    sources: SOURCES,
    products: PRODUCTS,
    recipes: RECIPES,
    recipeProducts: RECIPE_PRODUCTS,
    concernCatalog: CONCERN_CATALOG,
    education: CONCERN_EDUCATION,
    concernProductRules: CONCERN_PRODUCT_RULES,
    recommendationRules: RECOMMENDATION_RULES,
    nutrientReferences: NUTRIENT_REFERENCES,
  });
}

export { DEMO_PROFILES } from "./demo-profiles";
