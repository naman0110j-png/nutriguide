import crypto from "node:crypto";
import type { ChangeLogEntry } from "../schemas";

export const CRITICAL_FIELDS: Record<string, string[]> = {
  products: ["age_min_months", "age_max_months", "age_guidance_text", "ingredients", "allergen_data", "official_instructions", "warnings"],
  recipes: ["ingredients", "allergens", "age_min_months", "age_max_months", "preparation_steps"],
  recipeProducts: ["validated_quantity", "usage_constraints", "use_description"],
  education: ["educational_content", "referral_conditions"],
  concernProductRules: ["eligibility_conditions", "exclusion_conditions", "parent_facing_explanation"],
  recommendationRules: ["conditions", "effects"],
  sources: ["url", "claims_supported"],
};

const IGNORE = new Set(["updated_at", "created_at", "last_fetched_at"]);

export const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

export function diffRecords(
  kind: string,
  id: string,
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown>,
  actor: string,
  sourceId: string | null = null,
  reviewStatus: ChangeLogEntry["review_status"] = "approved",
): ChangeLogEntry[] {
  const now = new Date().toISOString();
  const critical = new Set(CRITICAL_FIELDS[kind] ?? []);
  if (!prev) {
    return [{ id: crypto.randomUUID(), entity_type: kind, entity_id: id, field: null, previous_value: null, new_value: next, source_id: sourceId, changed_at: now, changed_by: actor, review_status: reviewStatus, critical: true }];
  }
  const fields = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: ChangeLogEntry[] = [];
  for (const f of fields) {
    if (IGNORE.has(f)) continue;
    if (stable(prev[f]) === stable(next[f])) continue;
    out.push({ id: crypto.randomUUID(), entity_type: kind, entity_id: id, field: f, previous_value: prev[f] ?? null, new_value: next[f] ?? null, source_id: sourceId, changed_at: now, changed_by: actor, review_status: reviewStatus, critical: critical.has(f) });
  }
  return out;
}
