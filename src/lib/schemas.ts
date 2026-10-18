/**
 * Domain schemas — the single source of truth for shapes used by the UI,
 * API routes, the recommendation engine, the AI validator and the seed data.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shared vocabularies                                                 */
/* ------------------------------------------------------------------ */

/** Canonical allergen / intolerance vocabulary. `lactose` is an intolerance trigger, not an allergen. */
export const ALLERGENS = [
  "milk",
  "lactose",
  "egg",
  "peanut",
  "tree_nut",
  "gluten",
  "wheat",
  "soy",
  "sesame",
  "fish",
  "shellfish",
  "mustard",
] as const;
export const AllergenSchema = z.enum(ALLERGENS);
export type Allergen = z.infer<typeof AllergenSchema>;

export const DIETARY_PATTERNS = ["vegetarian", "vegetarian_eggs", "non_vegetarian", "other"] as const;
export const DietaryPatternSchema = z.enum(DIETARY_PATTERNS);
export type DietaryPattern = z.infer<typeof DietaryPatternSchema>;

export const CONCERN_TYPES = [
  "picky_eating",
  "protein_foods",
  "fruit_veg",
  "calcium",
  "iron",
  "vitamin_d",
  "other_nutrient",
  "appetite",
  "feeding_symptom",
  "meal_prep",
  "product_question",
  "other",
] as const;
export const ConcernTypeSchema = z.enum(CONCERN_TYPES);
export type ConcernType = z.infer<typeof ConcernTypeSchema>;

/** Education topics include parent-selectable concerns plus system topics. */
export const EDUCATION_TOPICS = [
  ...CONCERN_TYPES,
  "limited_variety",
  "known_allergy",
  "supplement_questions",
  "oral_care",
  "under_two",
] as const;
export const EducationTopicSchema = z.enum(EDUCATION_TOPICS);
export type EducationTopic = z.infer<typeof EducationTopicSchema>;

export const NUTRIENT_CONCERNS: ConcernType[] = ["calcium", "iron", "vitamin_d", "other_nutrient"];

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "drink"] as const;
export const MealTypeSchema = z.enum(MEAL_TYPES);
export type MealType = z.infer<typeof MealTypeSchema>;

export const ASSIST_TYPES = [
  "recipes_with_products",
  "picky_alternatives",
  "understand_labels",
  "general_education",
  "easier_prep",
  "when_to_see_professional",
  "learn_products",
  "other",
] as const;
export const AssistTypeSchema = z.enum(ASSIST_TYPES);
export type AssistType = z.infer<typeof AssistTypeSchema>;

/* ------------------------------------------------------------------ */
/* Child profile (parent-entered)                                       */
/* ------------------------------------------------------------------ */

const shortText = (max = 200) => z.string().trim().max(max);
const tagList = z.array(shortText(60)).max(30).default([]);

export const AllergyEntrySchema = z.object({
  allergen: z.union([AllergenSchema, z.literal("other")]),
  /** Free-text label; required when allergen === "other". */
  label: shortText(60).optional(),
  kind: z.enum(["allergy", "intolerance"]).default("allergy"),
  severity: z.enum(["mild", "moderate", "severe", "unknown"]).optional(),
  reaction_details: shortText(300).optional(),
  source: z.literal("parent_reported").default("parent_reported"),
}).refine((a) => a.allergen !== "other" || (a.label && a.label.length > 0), {
  message: "Please name the allergen or intolerance",
  path: ["label"],
});
export type AllergyEntry = z.infer<typeof AllergyEntrySchema>;

export const ConcernEntrySchema = z.object({
  type: ConcernTypeSchema,
  parent_description: shortText(500).optional(),
  reported_status: z
    .enum(["general_concern", "suspected", "professional_identified", "not_sure"])
    .default("not_sure"),
  professional_instructions_given: z.enum(["yes", "no", "not_sure"]).optional(),
  /** Shared for informational context only; never treated as an instruction by the app. */
  professional_instructions_text: shortText(500).optional(),
});
export type ConcernEntry = z.infer<typeof ConcernEntrySchema>;

export const OwnedProductSchema = z.object({
  catalog_product_id: z.string().max(80).nullable().default(null),
  is_external_unverified: z.boolean().default(false),
  brand: shortText(80),
  product_name: shortText(120),
  variant: shortText(80).optional(),
  age_variant: shortText(40).optional(),
  frequency: shortText(80).optional(),
  /** Parent-reported routine. Never treated as the official instruction. */
  parent_reported_routine: shortText(300).optional(),
  follows_pack_instructions: z.enum(["yes", "no", "not_sure"]).default("not_sure"),
  difficulties: shortText(500).optional(),
  wants_help: z.array(z.enum(["using", "label", "alternatives"])).default([]),
});
export type OwnedProduct = z.infer<typeof OwnedProductSchema>;

export const ChildProfileSchema = z
  .object({
    id: z.string().optional(),
    nickname: shortText(30).optional(),
    age_years: z.number({ invalid_type_error: "Enter the age in years" }).int().min(0).max(18),
    age_months: z.number().int().min(0, "Months must be 0–11").max(11, "Months must be 0–11").default(0),
    gender: z.enum(["girl", "boy", "another", "prefer_not"]).optional(),
    dietary_pattern: DietaryPatternSchema,
    dietary_other: shortText(120).optional(),
    no_known_allergies: z.boolean().default(false),
    allergies: z.array(AllergyEntrySchema).max(20).default([]),
    likes: tagList,
    refuses: tagList,
    textures_accepted: tagList,
    textures_refused: tagList,
    eating_difficulties: shortText(500).optional(),
    concerns: z.array(ConcernEntrySchema).max(12).default([]),
    meals: z
      .object({
        breakfast: shortText(300).optional(),
        lunch: shortText(300).optional(),
        dinner: shortText(300).optional(),
        snacks: shortText(300).optional(),
        beverages: shortText(300).optional(),
      })
      .default({}),
    eats_outside: z.enum(["school", "daycare", "both", "no", "not_sure"]).optional(),
    prep_time: z.enum(["5", "10", "20", "30plus"]).optional(),
    cooking_complexity: z.enum(["very_simple", "simple", "happy_to_cook"]).optional(),
    available_ingredients: tagList,
    products: z.array(OwnedProductSchema).max(15).default([]),
    assistance: z.array(AssistTypeSchema).default([]),
    assistance_other: shortText(300).optional(),
    consent: z
      .object({
        persist: z.boolean().default(false),
        ai_explanations: z.boolean().default(false),
      })
      .default({ persist: false, ai_explanations: false }),
    is_demo: z.boolean().default(false),
  })
  .refine((p) => p.age_years * 12 + p.age_months <= 18 * 12, {
    message: "This tool is designed for children up to 18 years",
    path: ["age_years"],
  })
  .refine((p) => p.dietary_pattern !== "other" || (p.dietary_other && p.dietary_other.length > 0), {
    message: "Please describe the dietary pattern",
    path: ["dietary_other"],
  });
export type ChildProfile = z.infer<typeof ChildProfileSchema>;

/* ------------------------------------------------------------------ */
/* Knowledge base                                                       */
/* ------------------------------------------------------------------ */

export const ReviewStatusSchema = z.enum(["approved", "pending_review", "needs_rereview", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const EvidenceSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().url(),
  publisher: z.string(),
  source_type: z.enum([
    "official_manufacturer_page",
    "manufacturer_marketing",
    "manufacturer_blog",
    "public_health_guidance",
    "government_reference",
    "paediatric_guidance",
    "hospital_patient_education",
  ]),
  retrieved_at: z.string(),
  published_at: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  review_status: ReviewStatusSchema,
  claims_supported: z.array(z.string()).default([]),
  notes: z.string().default(""),
});
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const PRODUCT_CATEGORIES = ["nutrition_powder", "gummies", "snack", "oral_care", "spread", "other"] as const;
export const ProductCategorySchema = z.enum(PRODUCT_CATEGORIES);
export type ProductCategory = z.infer<typeof ProductCategorySchema>;

export const FieldStatusSchema = z.enum(["verified", "unverified", "conflict", "missing"]);
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const CRITICAL_PRODUCT_FIELDS = ["age_guidance", "ingredients", "allergens", "instructions", "warnings"] as const;
export type CriticalProductField = (typeof CRITICAL_PRODUCT_FIELDS)[number];

export const ProductSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  brand: z.string(),
  product_family: z.string(),
  variant_name: z.string(),
  category: ProductCategorySchema,
  flavour: z.string().nullable(),
  pack_size: z.string().nullable(),
  age_min_months: z.number().int().nullable(),
  age_max_months: z.number().int().nullable(),
  /** Age guidance exactly as stated by the source. */
  age_guidance_text: z.string().nullable(),
  ingredients: z.object({
    items: z.array(z.object({ name: z.string(), allergens: z.array(AllergenSchema).default([]), share: z.string().optional() })),
    completeness: z.enum(["complete", "partial", "unknown"]),
    note: z.string().default(""),
  }),
  nutrient_data: z.object({
    items: z.array(z.object({ nutrient: z.string(), amount: z.string(), unit: z.string(), per: z.string(), note: z.string().optional() })),
    completeness: z.enum(["complete", "partial", "unknown"]),
    manufacturer_stated: z.boolean().default(true),
    note: z.string().default(""),
  }),
  allergen_data: z.object({
    contains: z.array(AllergenSchema),
    preparation_adds: z.array(AllergenSchema).default([]),
    statement: z.string().nullable(),
    basis: z.enum(["declared_by_manufacturer", "derived_from_ingredient_list", "derived_from_partial_ingredients", "unknown"]),
    cross_contact_info: z.string().nullable(),
  }),
  official_instructions: z.object({
    text: z.string().nullable(),
    verified: z.boolean(),
    source_quote: z.string().nullable(),
    note: z.string().default(""),
  }),
  warnings: z.array(z.string()).default([]),
  description: z.string(),
  official_url: z.string().url(),
  image_url: z.string().url().nullable(),
  source_type: z.enum(["official_manufacturer_page", "manual_entry", "third_party"]),
  last_fetched_at: z.string().nullable(),
  last_reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
  review_status: ReviewStatusSchema,
  recommendation_eligible: z.boolean(),
  active: z.boolean().default(true),
  field_status: z.record(z.enum(CRITICAL_PRODUCT_FIELDS), FieldStatusSchema),
  conflicts: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  source_ids: z.array(z.string()).default([]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Product = z.infer<typeof ProductSchema>;

export const RecipeStatusSchema = z.enum(["verified", "review_required", "demo", "unavailable"]);
export type RecipeStatus = z.infer<typeof RecipeStatusSchema>;

export const RecipeIngredientSchema = z.object({
  name: z.string(),
  quantity: z.string(),
  unit: z.string().default(""),
  allergens: z.array(AllergenSchema).default([]),
  /** Animal-source flags used for the dietary-pattern filter. */
  diet_flags: z.array(z.enum(["egg", "meat", "fish", "dairy"])).default([]),
  optional: z.boolean().default(false),
  product_id: z.string().optional(),
});
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;

export const RecipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  description: z.string(),
  age_min_months: z.number().int().nullable(),
  age_max_months: z.number().int().nullable(),
  meal_types: z.array(MealTypeSchema),
  ingredients: z.array(RecipeIngredientSchema).min(1),
  preparation_steps: z.array(z.string()).min(1),
  prep_time_minutes: z.number().int().min(0),
  cook_time_minutes: z.number().int().min(0),
  difficulty: z.enum(["easy", "moderate", "involved"]),
  /** Union of non-optional ingredient allergens. Validated against ingredients in tests. */
  allergens: z.array(AllergenSchema),
  dietary_tags: z.array(z.string()),
  food_groups: z.array(z.string()),
  textures: z.array(z.string()).default([]),
  concern_tags: z.array(ConcernTypeSchema),
  nutritional_information: z.null(),
  /** Practical (not clinical) benefit. */
  benefit_description: z.string(),
  substitutions: z.array(z.object({ for: z.string(), use: z.string(), note: z.string().optional() })).default([]),
  caveats: z.array(z.string()).default([]),
  source_status: z.enum(["documented_source", "adapted_from_source", "original_demo_concept"]),
  source_ids: z.array(z.string()).default([]),
  source_notes: z.string().default(""),
  review_status: RecipeStatusSchema,
  active: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeProductSchema = z.object({
  id: z.string(),
  recipe_id: z.string(),
  product_id: z.string(),
  use_description: z.string(),
  validated_quantity: z.string().nullable(),
  quantity_unit: z.string().nullable(),
  usage_constraints: z.array(z.string()).default([]),
  evidence_source_id: z.string().nullable(),
  review_status: ReviewStatusSchema,
  conflict_notes: z.string().default(""),
});
export type RecipeProduct = z.infer<typeof RecipeProductSchema>;

export const ConcernCatalogSchema = z.object({
  id: ConcernTypeSchema,
  name: z.string(),
  description: z.string(),
  type: z.enum(["practical", "dietary", "symptom_related", "nutrient_related"]),
  risk_level: z.enum(["low", "medium", "high"]),
  professional_review_required: z.boolean(),
  education_topics: z.array(EducationTopicSchema),
});
export type ConcernCatalog = z.infer<typeof ConcernCatalogSchema>;

export const ConcernEducationSchema = z.object({
  id: z.string(),
  concern_type: EducationTopicSchema,
  title: z.string(),
  /** General educational explanation. */
  educational_content: z.array(z.string()),
  /** Food-related, practical guidance. Kept separate from product claims. */
  food_guidance: z.array(z.string()).default([]),
  missing_information_questions: z.array(z.string()).default([]),
  recommended_next_steps: z.array(z.string()),
  /** When a qualified professional should be involved. */
  referral_conditions: z.array(z.string()),
  evidence_source_ids: z.array(z.string()),
  review_status: ReviewStatusSchema,
});
export type ConcernEducation = z.infer<typeof ConcernEducationSchema>;

export const ConcernProductRuleSchema = z.object({
  id: z.string(),
  concern_type: ConcernTypeSchema,
  product_id: z.string(),
  relationship_type: z.enum(["informational_contains_nutrient", "informational_food_format", "professionally_governed"]),
  intended_purpose: z.string(),
  eligibility_conditions: z.object({
    requires_assistance: z.array(AssistTypeSchema).default([]),
    min_age_months: z.number().int().nullable().default(null),
    max_age_months: z.number().int().nullable().default(null),
  }),
  exclusion_conditions: z.object({
    allergens: z.array(AllergenSchema).default([]),
    concern_statuses: z.array(z.string()).default([]),
  }),
  parent_facing_explanation: z.string(),
  evidence_source_id: z.string().nullable(),
  review_status: ReviewStatusSchema,
});
export type ConcernProductRule = z.infer<typeof ConcernProductRuleSchema>;

export const RuleConditionSchema = z.object({
  fact: z.enum([
    "age_months",
    "concern_types",
    "concern_status",
    "allergy_severity",
    "has_allergies",
    "dietary_pattern",
  ]),
  op: z.enum(["lt", "lte", "gt", "gte", "eq", "includes", "includes_any"]),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]),
});
export type RuleCondition = z.infer<typeof RuleConditionSchema>;

export const RecommendationRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  conditions: z.array(RuleConditionSchema).min(1),
  effects: z.object({
    block_product_suggestions: z.boolean().default(false),
    block_unreviewed_recipes: z.boolean().default(false),
    add_education_topics: z.array(EducationTopicSchema).default([]),
    professional_guidance: z.string().nullable().default(null),
    warning: z.string().nullable().default(null),
  }),
  output_type: z.enum(["referral", "restriction", "warning", "education"]),
  required_review_status: ReviewStatusSchema.default("approved"),
  review_status: ReviewStatusSchema,
});
export type RecommendationRule = z.infer<typeof RecommendationRuleSchema>;

export const NutrientReferenceSchema = z.object({
  id: z.string(),
  nutrient_name: z.string(),
  age_group: z.string(),
  unit: z.string(),
  reference_value: z.number(),
  reference_type: z.string(),
  source_id: z.string(),
  review_status: ReviewStatusSchema,
  notes: z.string().default(""),
});
export type NutrientReference = z.infer<typeof NutrientReferenceSchema>;

export const FeedbackSchema = z.object({
  recommendation_type: z.enum(["recipe", "product_info", "education", "overview", "chat"]),
  recommendation_id: z.string().max(80).nullable().default(null),
  rating: z.enum(["helpful", "not_helpful"]).nullable().default(null),
  feedback_text: shortText(1000).nullable().default(null),
});
export type Feedback = z.infer<typeof FeedbackSchema>;

export const SavedItemSchema = z.object({
  item_type: z.enum(["recipe", "product"]),
  item_id: z.string().max(80),
  note: shortText(300).optional(),
});
export type SavedItem = z.infer<typeof SavedItemSchema>;

export const ChangeLogEntrySchema = z.object({
  id: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  field: z.string().nullable(),
  previous_value: z.unknown(),
  new_value: z.unknown(),
  source_id: z.string().nullable(),
  changed_at: z.string(),
  changed_by: z.string(),
  review_status: ReviewStatusSchema,
  critical: z.boolean().default(false),
});
export type ChangeLogEntry = z.infer<typeof ChangeLogEntrySchema>;

export const ProductImportSchema = z.object({
  id: z.string(),
  url: z.string(),
  canonical_url: z.string().nullable(),
  matched_product_id: z.string().nullable(),
  fetched_at: z.string(),
  status: z.enum(["new", "unchanged", "changed", "failed", "approved", "rejected"]),
  extracted: z.record(z.unknown()),
  diff: z
    .array(z.object({ field: z.string(), previous: z.unknown(), next: z.unknown(), critical: z.boolean() }))
    .default([]),
  missing_fields: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),
});
export type ProductImport = z.infer<typeof ProductImportSchema>;
