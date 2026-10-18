import "server-only";
import { z } from "zod";
import { ChildProfileSchema, ConcernTypeSchema, MealTypeSchema, type ChildProfile } from "../schemas";
import { getRepository } from "../repo";
import { buildOverview } from "../engine/overview";
import { recommend } from "../engine/recommend";
import { explain } from "../ai/explain";
import { answerChat } from "../ai/chat";
import { getConfig } from "./config";
import { log } from "./log";

export const RecommendationRequestSchema = z.object({
  profile: ChildProfileSchema,
  concern: z.union([ConcernTypeSchema, z.literal("general")]).default("general"),
  mealType: MealTypeSchema.optional(),
  maxMinutes: z.number().int().min(1).max(240).optional(),
  avoid: z.array(z.string().trim().max(40)).max(10).optional(),
  offset: z.number().int().min(0).max(60).optional(),
  withExplanation: z.boolean().default(true),
});

export const ChatRequestSchema = z.object({
  profile: ChildProfileSchema,
  message: z.string().trim().min(1, "Type a question").max(600),
  concern: z.union([ConcernTypeSchema, z.literal("general")]).default("general"),
  shownRecipeIds: z.array(z.string().max(80)).max(12).default([]),
  offset: z.number().int().min(0).max(60).optional(),
});

export async function overviewFor(profile: ChildProfile) {
  const kb = await getRepository().getKnowledgeBase();
  return buildOverview(profile, kb);
}

/**
 * Full pipeline: deterministic retrieval + filtering → (optional) LLM explanation →
 * validation → structured output. The LLM never sees records that failed a check.
 */
export async function recommendationsFor(input: z.infer<typeof RecommendationRequestSchema>) {
  const cfg = getConfig();
  const kb = await getRepository().getKnowledgeBase();
  const { profile } = input;
  const result = recommend(profile, { concern: input.concern, mealType: input.mealType, maxMinutes: input.maxMinutes, avoid: input.avoid, offset: input.offset, contentMode: cfg.contentMode }, kb);
  const overview = buildOverview(profile, kb);
  const ai = input.withExplanation
    ? await explain(profile, result, overview, { llm: cfg.llm, consent: !!profile.consent?.ai_explanations })
    : null;
  if (ai) log.info("explain", { generated_by: ai.generated_by, attempts: ai.attempts, rejected_count: ai.validation_errors.length });

  const notes = new Map(ai?.explanation.recipe_notes.map((n) => [n.recipe_id, n.relevance_explanation]) ?? []);
  const pnotes = new Map(ai?.explanation.product_notes.map((n) => [n.product_id, n.relevance_explanation]) ?? []);

  // Structured output contract (see README "Structured output").
  return {
    generated_by: ai?.generated_by ?? "deterministic",
    ai_notice: ai?.notice ?? null,
    content_mode: result.content_mode,
    concern: result.concern,
    concern_label: result.concern_label,
    profile_summary: ai?.explanation.profile_summary ?? overview.summary,
    known_information: overview.known,
    reported_concerns: overview.concerns,
    areas_to_explore: overview.areas_to_explore,
    information_gaps: result.information_gaps,
    general_education: result.education,
    education_summary: ai?.explanation.education_summary ?? null,
    recipe_recommendations: result.recipes.map((c) => ({ ...c, explanation: notes.get(c.recipe.id) ?? c.relevance.join(" ") })),
    more_recipes: result.more_recipes,
    excluded: result.excluded,
    recipe_placeholder: result.recipe_placeholder,
    owned_products: result.owned_products.map((o) => ({ ...o, explanation: o.product ? pnotes.get(o.product.id) ?? o.routine_note : o.routine_note })),
    product_information: result.product_suggestions.map((s) => ({ ...s, explanation: pnotes.get(s.product.id) ?? s.explanation })),
    product_information_note: result.product_suggestions_note,
    professional_guidance: result.professional_guidance,
    warnings: result.warnings,
    applied_rules: result.applied_rules,
    evidence_sources: result.sources,
    disclaimers: result.disclaimers,
    closing_note: ai?.explanation.closing_note ?? null,
  };
}

export async function chatFor(input: z.infer<typeof ChatRequestSchema>) {
  const cfg = getConfig();
  const kb = await getRepository().getKnowledgeBase();
  return answerChat(input.profile, input.message, { concern: input.concern, contentMode: cfg.contentMode, shownRecipeIds: input.shownRecipeIds, offset: input.offset }, kb, { llm: cfg.llm, consent: !!input.profile.consent?.ai_explanations });
}
