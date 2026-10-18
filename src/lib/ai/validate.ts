/**
 * Output validation for anything an LLM writes. Text that fails ANY check is not shown.
 * The checks are deliberately conservative: false positives fall back to reviewed,
 * deterministic text, which is always available.
 */
import { z } from "zod";

export interface SafetyViolation {
  rule: string;
  excerpt: string;
}

const PATTERNS: { rule: string; re: RegExp }[] = [
  { rule: "diagnosis", re: /\b(your child|he|she|they|your (son|daughter))\b[^.]{0,30}\b(is|are|seems?|may be|might be|appears? to be|could be|likely)\b[^.]{0,15}\b(deficient|anaemic|anemic|malnourished|underweight|lactose intolerant|allergic)\b/i },
  { rule: "diagnosis", re: /\b(has|have|likely has|may have|probably has)\b[^.]{0,10}\b(a |an )?(deficiency|anaemia|anemia|disorder|disease|condition)\b/i },
  { rule: "treatment_claim", re: /\b(treat|treats|treating|cure|cures|cured|fix(es)?|heal(s)?|reverse(s)?)\b[^.]{0,25}\b(deficienc\w*|anaemia|anemia|constipation|picky eating|allerg\w*|disease|condition)\b/i },
  { rule: "outcome_promise", re: /\b(will|guarantee[sd]?|proven to|clinically proven|definitely)\b[^.]{0,40}\b(improve|boost|increase|grow|strengthen|prevent|fix|make)\b/i },
  { rule: "outcome_promise", re: /\b(boosts?|improves?|increases?)\b[^.]{0,10}\b(immunity|height|intelligence|iq|brain power|growth)\b/i },
  { rule: "prescription", re: /\b(you should|you must|make sure to|start)\b[^.]{0,25}\b(give|giving|take|taking|add|adding)\b[^.]{0,25}\b(supplement|gummies|tablets?|capsules?|syrup|drops)\b/i },
  { rule: "serving_change", re: /\b(increase|double|triple|add (an )?extra|more)\b[^.]{0,15}\b(scoops?|servings?|dose|doses|dosage|gummies|amount of (the )?(powder|product|supplement))\b/i },
  { rule: "meal_replacement", re: /\b(instead of|replace|replacing|in place of|substitute for)\b[^.]{0,15}\b(a |the |their )?(meal|meals|breakfast|lunch|dinner)\b/i },
  { rule: "unsupported_nutrient_label", re: /\b(high[- ]in|rich in|packed with|loaded with|excellent source of|great source of)\b[^.]{0,10}\b(protein|calcium|iron|fib(re|er)|vitamins?|minerals?|omega|dha)\b|\b(high[- ]protein|iron[- ]rich|calcium[- ]rich|protein[- ]packed)\b/i },
  { rule: "safety_guarantee", re: /\b(100% safe|completely safe|perfectly safe|totally safe|safe for (all|every)|allergy[- ]safe|allergen[- ]free|no risk)\b/i },
];

const QUANTITY = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|iu|g|grams?|ml|l|scoops?|gummies|tablets?|capsules?|tsp|tbsp|cups?|times (?:a|per) day)\b/gi;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/(\d),(\d)/g, "$1.$2");

/** Checks free text written by a model. `allowedCorpus` = the facts the model was given. */
export function lintText(text: string, allowedCorpus: string): SafetyViolation[] {
  const out: SafetyViolation[] = [];
  for (const { rule, re } of PATTERNS) {
    const m = text.match(re);
    if (m) out.push({ rule, excerpt: m[0].slice(0, 80) });
  }
  const corpus = norm(allowedCorpus).replace(/\s/g, "");
  for (const m of text.matchAll(QUANTITY)) {
    if (!corpus.includes(norm(m[0]).replace(/\s/g, ""))) out.push({ rule: "unsourced_quantity", excerpt: m[0] });
  }
  return out;
}

export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in response");
  return JSON.parse(raw.slice(start, end + 1));
}

const text = (max: number) => z.string().trim().min(1).max(max);

export const AiExplanationSchema = z.object({
  profile_summary: text(900),
  recipe_notes: z.array(z.object({ recipe_id: z.string(), relevance_explanation: text(400) })).max(6),
  product_notes: z.array(z.object({ product_id: z.string(), relevance_explanation: text(400) })).max(6).default([]),
  education_summary: text(900),
  information_gaps: z.array(text(240)).max(6).default([]),
  closing_note: text(400),
});
export type AiExplanation = z.infer<typeof AiExplanationSchema>;

export const AiChatSchema = z.object({
  answer: text(1400),
  recipe_ids: z.array(z.string()).max(3).default([]),
});
export type AiChat = z.infer<typeof AiChatSchema>;

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
}

function allStrings(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.flatMap(allStrings);
  if (v && typeof v === "object") return Object.values(v).flatMap(allStrings);
  return [];
}

/** Schema + reference + safety validation for the explanation output. */
export function validateExplanation(raw: string, allowed: { recipeIds: Set<string>; productIds: Set<string>; corpus: string }): ValidationResult<AiExplanation> {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    return { ok: false, errors: [`invalid_json: ${(e as Error).message}`] };
  }
  const res = AiExplanationSchema.safeParse(parsed);
  if (!res.success) return { ok: false, errors: res.error.issues.map((i) => `schema: ${i.path.join(".")} ${i.message}`) };
  const errors: string[] = [];
  for (const n of res.data.recipe_notes) if (!allowed.recipeIds.has(n.recipe_id)) errors.push(`unknown_recipe_id: ${n.recipe_id}`);
  for (const n of res.data.product_notes) if (!allowed.productIds.has(n.product_id)) errors.push(`unknown_product_id: ${n.product_id}`);
  for (const s of allStrings(res.data)) for (const v of lintText(s, allowed.corpus)) errors.push(`${v.rule}: "${v.excerpt}"`);
  return errors.length ? { ok: false, errors } : { ok: true, value: res.data, errors: [] };
}

export function validateChat(raw: string, allowed: { recipeIds: Set<string>; corpus: string }): ValidationResult<AiChat> {
  let parsed: unknown;
  try {
    parsed = extractJson(raw);
  } catch (e) {
    return { ok: false, errors: [`invalid_json: ${(e as Error).message}`] };
  }
  const res = AiChatSchema.safeParse(parsed);
  if (!res.success) return { ok: false, errors: res.error.issues.map((i) => `schema: ${i.path.join(".")} ${i.message}`) };
  const errors: string[] = [];
  for (const id of res.data.recipe_ids) if (!allowed.recipeIds.has(id)) errors.push(`unknown_recipe_id: ${id}`);
  for (const v of lintText(res.data.answer, allowed.corpus)) errors.push(`${v.rule}: "${v.excerpt}"`);
  return errors.length ? { ok: false, errors } : { ok: true, value: res.data, errors: [] };
}
