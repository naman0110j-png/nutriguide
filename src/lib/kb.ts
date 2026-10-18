import type {
  ConcernCatalog,
  ConcernEducation,
  ConcernProductRule,
  EvidenceSource,
  NutrientReference,
  Product,
  Recipe,
  RecipeProduct,
  RecommendationRule,
} from "./schemas";

/** The full read-only knowledge base the engine works from. */
export interface KnowledgeBase {
  sources: EvidenceSource[];
  products: Product[];
  recipes: Recipe[];
  recipeProducts: RecipeProduct[];
  concernCatalog: ConcernCatalog[];
  education: ConcernEducation[];
  concernProductRules: ConcernProductRule[];
  recommendationRules: RecommendationRule[];
  nutrientReferences: NutrientReference[];
}

export const ALLERGEN_LABELS: Record<string, string> = {
  milk: "milk",
  lactose: "lactose",
  egg: "egg",
  peanut: "peanut",
  tree_nut: "tree nuts",
  gluten: "gluten",
  wheat: "wheat",
  soy: "soy",
  sesame: "sesame",
  fish: "fish",
  shellfish: "shellfish",
  mustard: "mustard",
};

export const DIET_LABELS: Record<string, string> = {
  vegetarian: "vegetarian",
  vegetarian_eggs: "vegetarian with eggs",
  non_vegetarian: "non-vegetarian",
  other: "another dietary pattern",
};

export const CONCERN_LABELS: Record<string, string> = {
  picky_eating: "Picky eating or limited food variety",
  protein_foods: "Including protein-rich foods",
  fruit_veg: "Including fruit or vegetables",
  calcium: "Concern about calcium",
  iron: "Concern about iron",
  vitamin_d: "Concern about vitamin D",
  other_nutrient: "Concern about another nutrient",
  appetite: "Appetite or meal refusal",
  feeding_symptom: "Constipation or another feeding concern",
  meal_prep: "Making meal preparation easier",
  product_question: "Using a product I already have",
  other: "Something else",
};

export const STATUS_LABELS: Record<string, string> = {
  general_concern: "general concern",
  suspected: "suspected by parent",
  professional_identified: "identified by a healthcare professional",
  not_sure: "not sure",
};

export const ASSIST_LABELS: Record<string, string> = {
  recipes_with_products: "recipe ideas using products you have",
  picky_alternatives: "food alternatives for a picky eater",
  understand_labels: "help understanding product labels and instructions",
  general_education: "general nutrition education",
  easier_prep: "easier food preparation",
  when_to_see_professional: "knowing when to seek professional advice",
  learn_products: "learning about relevant products",
  other: "something else",
};

export function sourceById(kb: KnowledgeBase, id: string | null | undefined) {
  return id ? kb.sources.find((s) => s.id === id) : undefined;
}
export function productById(kb: KnowledgeBase, id: string | null | undefined) {
  return id ? kb.products.find((p) => p.id === id) : undefined;
}
export function recipeById(kb: KnowledgeBase, id: string | null | undefined) {
  return id ? kb.recipes.find((r) => r.id === id) : undefined;
}
