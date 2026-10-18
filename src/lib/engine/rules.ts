import type { ChildProfile, EducationTopic, RecommendationRule, RuleCondition } from "../schemas";
import { NUTRIENT_CONCERNS } from "../schemas";
import { totalMonths } from "./checks";

export interface RuleFacts {
  age_months: number;
  concern_types: string[];
  /** Statuses of nutrient-related concerns only. */
  concern_status: string[];
  allergy_severity: string[];
  has_allergies: boolean;
  dietary_pattern: string;
}

export function factsFor(profile: ChildProfile, focusConcern?: string): RuleFacts {
  const types = new Set(profile.concerns.map((c) => c.type as string));
  if (focusConcern && focusConcern !== "general") types.add(focusConcern);
  return {
    age_months: totalMonths(profile),
    concern_types: [...types],
    concern_status: profile.concerns.filter((c) => NUTRIENT_CONCERNS.includes(c.type)).map((c) => c.reported_status),
    allergy_severity: profile.allergies.map((a) => a.severity ?? "unknown"),
    has_allergies: profile.allergies.length > 0,
    dietary_pattern: profile.dietary_pattern,
  };
}

export function evalCondition(c: RuleCondition, facts: RuleFacts): boolean {
  const v = facts[c.fact] as unknown;
  switch (c.op) {
    case "lt":
      return typeof v === "number" && v < (c.value as number);
    case "lte":
      return typeof v === "number" && v <= (c.value as number);
    case "gt":
      return typeof v === "number" && v > (c.value as number);
    case "gte":
      return typeof v === "number" && v >= (c.value as number);
    case "eq":
      return Array.isArray(v) ? v.includes(c.value as string) : v === c.value;
    case "includes":
      return Array.isArray(v) && v.includes(c.value as string);
    case "includes_any":
      return Array.isArray(v) && Array.isArray(c.value) && c.value.some((x) => v.includes(x));
    default:
      return false;
  }
}

export interface AppliedRules {
  applied: { id: string; name: string; output_type: string }[];
  blockProducts: boolean;
  blockUnreviewedRecipes: boolean;
  educationTopics: EducationTopic[];
  professionalGuidance: string[];
  warnings: string[];
}

/** Only approved rules are applied. Unreviewed rules never change parent-facing output. */
export function applyRules(rules: RecommendationRule[], facts: RuleFacts): AppliedRules {
  const out: AppliedRules = { applied: [], blockProducts: false, blockUnreviewedRecipes: false, educationTopics: [], professionalGuidance: [], warnings: [] };
  for (const rule of rules) {
    if (rule.review_status !== "approved") continue;
    if (!rule.conditions.every((c) => evalCondition(c, facts))) continue;
    out.applied.push({ id: rule.id, name: rule.name, output_type: rule.output_type });
    if (rule.effects.block_product_suggestions) out.blockProducts = true;
    if (rule.effects.block_unreviewed_recipes) out.blockUnreviewedRecipes = true;
    out.educationTopics.push(...rule.effects.add_education_topics);
    if (rule.effects.professional_guidance) out.professionalGuidance.push(rule.effects.professional_guidance);
    if (rule.effects.warning) out.warnings.push(rule.effects.warning);
  }
  out.educationTopics = [...new Set(out.educationTopics)];
  return out;
}
