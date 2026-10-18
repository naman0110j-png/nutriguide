/**
 * Retrieval-augmented explanation layer. The deterministic engine has already chosen
 * and filtered everything; the model may only phrase explanations for those items.
 */
import type { ChildProfile } from "../schemas";
import type { RecommendationResult } from "../engine/recommend";
import type { Overview } from "../engine/overview";
import { ALLERGEN_LABELS, CONCERN_LABELS, STATUS_LABELS } from "../kb";
import { callLlm, type FetchLike, type LlmConfig, LlmError } from "./provider";
import { validateExplanation, type AiExplanation } from "./validate";

export const SYSTEM_PROMPT = `You are the explanation layer of a parent-facing child-nutrition EDUCATION tool.
A deterministic backend has ALREADY selected and safety-filtered every recipe and product. You only write short, warm, plain-English explanations for the items you are given.

Hard rules (violations are rejected automatically and never shown):
- Never diagnose or suggest the child has or may have a deficiency, disease or condition. Refer to concerns as "the concern you mentioned".
- Refer to allergies as "the allergy you reported" — never "your child is allergic".
- Never prescribe, recommend starting, or suggest amounts of any supplement or product. Never suggest increasing, doubling or adding extra servings.
- Never mention any quantity (mg, g, ml, IU, scoops, gummies, times a day) unless it appears verbatim in the facts provided.
- Never use nutrient marketing labels ("high in", "rich in", "packed with", "high-protein", "iron-rich"). Use factual phrases like "includes a dairy food".
- Never promise outcomes (immunity, height, brain, growth) and never call anything "safe" for allergies.
- Never suggest replacing meals.
- Practical benefits only (taste, texture, time, familiarity) — not clinical benefits.
- Only use recipe_id and product_id values present in the input.
Return ONLY a JSON object, no prose, matching:
{"profile_summary": string, "recipe_notes": [{"recipe_id": string, "relevance_explanation": string}], "product_notes": [{"product_id": string, "relevance_explanation": string}], "education_summary": string, "information_gaps": string[], "closing_note": string}`;

export interface EvidenceBundle {
  child: Record<string, unknown>;
  concern: string;
  recipes: Record<string, unknown>[];
  products: Record<string, unknown>[];
  education: { title: string; points: string[] }[];
  information_gaps: string[];
  professional_guidance: string[];
}

/** De-identified: no nickname, no free-text descriptions, no professional notes. */
export function buildEvidenceBundle(profile: ChildProfile, result: RecommendationResult): EvidenceBundle {
  return {
    child: {
      age_months: result.age_months,
      dietary_pattern: profile.dietary_pattern,
      reported_allergies: profile.allergies.map((a) => (a.allergen === "other" ? "other (parent-described)" : ALLERGEN_LABELS[a.allergen])),
      reported_concerns: profile.concerns.map((c) => `${CONCERN_LABELS[c.type]} (${STATUS_LABELS[c.reported_status]})`),
      likes: profile.likes.slice(0, 8),
      often_refuses: profile.refuses.slice(0, 8),
      textures_accepted: profile.textures_accepted,
      prep_time_minutes: profile.prep_time ?? "not stated",
    },
    concern: result.concern_label,
    recipes: result.recipes.map((c) => ({
      recipe_id: c.recipe.id,
      name: c.recipe.name,
      evidence_label: c.evidence_label,
      ingredients: c.recipe.ingredients.map((i) => `${i.quantity} ${i.unit} ${i.name}`.replace(/\s+/g, " ").trim()),
      practical_benefit: c.recipe.benefit_description,
      matched_because: c.relevance,
      total_minutes: c.recipe.prep_time_minutes + c.recipe.cook_time_minutes,
      caveats: c.recipe.caveats,
    })),
    products: [
      ...result.owned_products.filter((o) => o.product).map((o) => ({ product_id: o.product!.id, variant: o.product!.variant_name, official_instructions: o.official_instructions ?? "not verified — follow the pack", relation: "already used by the family" })),
      ...result.product_suggestions.map((s) => ({ product_id: s.product.id, variant: s.product.variant_name, official_instructions: s.official_instructions, relation: "optional information the parent asked for", explanation: s.explanation })),
    ],
    education: result.education.slice(0, 3).map((e) => ({ title: e.title, points: [...e.educational_content, ...e.food_guidance].slice(0, 4) })),
    information_gaps: result.information_gaps,
    professional_guidance: result.professional_guidance,
  };
}

export function deterministicExplanation(result: RecommendationResult, overview: Pick<Overview, "summary">): AiExplanation {
  const edu = result.education[0];
  return {
    profile_summary: overview.summary,
    recipe_notes: result.recipes.map((c) => ({ recipe_id: c.recipe.id, relevance_explanation: c.relevance.join(" ") })),
    product_notes: [
      ...result.owned_products.filter((o) => o.product).map((o) => ({ product_id: o.product!.id, relevance_explanation: o.routine_note ?? "Official information for the product you already use." })),
      ...result.product_suggestions.map((s) => ({ product_id: s.product.id, relevance_explanation: s.explanation })),
    ],
    education_summary: edu ? `${edu.title}. ${edu.educational_content[0]}` : "General food ideas matched to your child's age, diet and allergies.",
    information_gaps: result.information_gaps.slice(0, 6),
    closing_note: "These are practical ideas, not medical advice. A paediatrician or registered dietitian can help with anything specific to your child.",
  };
}

export interface ExplainOutcome {
  explanation: AiExplanation;
  generated_by: "llm" | "deterministic";
  notice: string | null;
  attempts: number;
  validation_errors: string[];
}

export async function explain(
  profile: ChildProfile,
  result: RecommendationResult,
  overview: Pick<Overview, "summary">,
  opts: { llm: LlmConfig | null; consent: boolean; fetchImpl?: FetchLike; maxAttempts?: number },
): Promise<ExplainOutcome> {
  const fallback = deterministicExplanation(result, overview);
  if (!opts.llm) return { explanation: fallback, generated_by: "deterministic", notice: "Demo mode: no AI provider is configured, so explanations come from reviewed templates.", attempts: 0, validation_errors: [] };
  if (!opts.consent) return { explanation: fallback, generated_by: "deterministic", notice: "AI-written explanations are off for this profile (you can turn them on in your profile).", attempts: 0, validation_errors: [] };

  const bundle = buildEvidenceBundle(profile, result);
  const corpus = JSON.stringify(bundle);
  const allowed = {
    recipeIds: new Set(result.recipes.map((c) => c.recipe.id)),
    productIds: new Set([...result.owned_products.filter((o) => o.product).map((o) => o.product!.id), ...result.product_suggestions.map((s) => s.product.id)]),
    corpus,
  };
  const maxAttempts = opts.maxAttempts ?? 2;
  let errors: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user =
      attempt === 1
        ? `Facts (JSON):\n${corpus}`
        : `Facts (JSON):\n${corpus}\n\nYour previous answer was rejected for: ${errors.slice(0, 6).join("; ")}. Rewrite it, fixing these issues. Return JSON only.`;
    try {
      const raw = await callLlm(opts.llm, { system: SYSTEM_PROMPT, user, maxTokens: 1200 }, opts.fetchImpl);
      const v = validateExplanation(raw, allowed);
      if (v.ok && v.value) {
        // Fill any recipe the model skipped with the deterministic note, so every card has text.
        const have = new Set(v.value.recipe_notes.map((n) => n.recipe_id));
        const notes = [...v.value.recipe_notes, ...fallback.recipe_notes.filter((n) => !have.has(n.recipe_id))];
        return { explanation: { ...v.value, recipe_notes: notes }, generated_by: "llm", notice: null, attempts: attempt, validation_errors: errors };
      }
      errors = v.errors;
    } catch (e) {
      const kind = e instanceof LlmError ? e.kind : "network";
      return { explanation: fallback, generated_by: "deterministic", notice: kind === "timeout" ? "The AI service timed out, so reviewed template explanations are shown instead." : "The AI service is unavailable right now, so reviewed template explanations are shown instead.", attempts: attempt, validation_errors: errors };
    }
  }
  return { explanation: fallback, generated_by: "deterministic", notice: "The AI explanation didn't pass our safety checks, so reviewed template explanations are shown instead.", attempts: maxAttempts, validation_errors: errors };
}
