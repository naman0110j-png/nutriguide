/**
 * Layer 2 — deterministic nutrition overview. Uses ONLY what the parent entered plus
 * verified product facts. It never infers a deficiency, diagnosis or growth status.
 */
import type { ChildProfile, ConcernType } from "../schemas";
import { NUTRIENT_CONCERNS } from "../schemas";
import type { KnowledgeBase } from "../kb";
import { ALLERGEN_LABELS, ASSIST_LABELS, CONCERN_LABELS, DIET_LABELS, STATUS_LABELS } from "../kb";
import { formatAge, totalMonths } from "./checks";
import { applyRules, factsFor } from "./rules";
import { resolveOwnedProducts } from "./products";

export type FactSource = "parent_reported" | "verified_product" | "calculated" | "general_education";

export interface KnownFact {
  label: string;
  value: string;
  source: FactSource;
  source_url?: string;
}

export interface Overview {
  summary: string;
  known: KnownFact[];
  concerns: { type: ConcernType; name: string; status: string; nutrient: boolean }[];
  areas_to_explore: { title: string; why: string; concern: ConcernType | "general" }[];
  cannot_determine: string[];
  information_gaps: string[];
  professional_guidance: string[];
  next_actions: { label: string; href: string }[];
  calculations_note: string;
  applied_rules: { id: string; name: string }[];
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function productLabel(p: ChildProfile["products"][number]) {
  return `${p.brand} ${p.product_name}${p.age_variant ? ` ${p.age_variant}` : ""}${p.variant ? ` (${p.variant})` : ""}`.trim();
}

export function buildOverview(profile: ChildProfile, kb: KnowledgeBase): Overview {
  const months = totalMonths(profile);
  const who = profile.nickname ? profile.nickname : "your child";
  const rules = applyRules(kb.recommendationRules, factsFor(profile));
  const owned = resolveOwnedProducts(profile, kb);

  /* ---------- Summary: plain language, parent facts only ---------- */
  const parts: string[] = [`is ${formatAge(months)} old`];
  const dietPhrase: Record<string, string> = {
    vegetarian: "follows a vegetarian diet",
    vegetarian_eggs: "follows a vegetarian diet that includes eggs",
    non_vegetarian: "eats a non-vegetarian diet",
    other: `follows ${profile.dietary_other ? `this diet: ${profile.dietary_other}` : "another dietary pattern"}`,
  };
  parts.push(dietPhrase[profile.dietary_pattern]);
  if (profile.allergies.length) {
    parts.push(`has ${profile.allergies.length === 1 ? "a reported" : "reported"} ${list(profile.allergies.map((a) => `${a.allergen === "other" ? a.label : ALLERGEN_LABELS[a.allergen]} ${a.kind}`))}`);
  }
  if (profile.refuses.length) parts.push(`often refuses ${list(profile.refuses.slice(0, 4))}`);
  if (profile.products.length) parts.push(`currently uses ${list(profile.products.map(productLabel))}`);
  const outer = parts.length <= 2 ? parts.join(" and ") : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  let summary = `You told us that ${who} ${outer}.`;
  if (profile.likes.length) summary += ` Foods ${profile.nickname ? profile.nickname : "your child"} enjoys include ${list(profile.likes.slice(0, 4))}.`;
  if (profile.assistance.length) summary += ` You'd like ${list(profile.assistance.filter((a) => a !== "other").map((a) => ASSIST_LABELS[a]))}${profile.assistance.includes("other") && profile.assistance_other ? `, and: "${profile.assistance_other}"` : ""}.`;

  /* ---------- What we know ---------- */
  const known: KnownFact[] = [
    { label: "Age", value: formatAge(months), source: "parent_reported" },
    { label: "Dietary pattern", value: profile.dietary_pattern === "other" ? profile.dietary_other ?? "Other" : DIET_LABELS[profile.dietary_pattern], source: "parent_reported" },
    {
      label: "Allergies & intolerances",
      value: profile.allergies.length
        ? profile.allergies.map((a) => `${a.allergen === "other" ? a.label : ALLERGEN_LABELS[a.allergen]} (${a.kind}${a.severity && a.severity !== "unknown" ? `, ${a.severity}` : ""})`).join("; ")
        : profile.no_known_allergies ? "None known" : "Not stated",
      source: "parent_reported",
    },
  ];
  if (profile.likes.length) known.push({ label: "Likes", value: profile.likes.join(", "), source: "parent_reported" });
  if (profile.refuses.length) known.push({ label: "Often refuses", value: profile.refuses.join(", "), source: "parent_reported" });
  if (profile.textures_accepted.length || profile.textures_refused.length) {
    known.push({ label: "Textures", value: [profile.textures_accepted.length ? `accepts ${profile.textures_accepted.join(", ")}` : "", profile.textures_refused.length ? `refuses ${profile.textures_refused.join(", ")}` : ""].filter(Boolean).join("; "), source: "parent_reported" });
  }
  const mealBits = (["breakfast", "lunch", "dinner", "snacks", "beverages"] as const).filter((k) => profile.meals[k]).map((k) => `${k}: ${profile.meals[k]}`);
  if (mealBits.length) known.push({ label: "Typical day", value: mealBits.join(" · "), source: "parent_reported" });
  for (const o of owned) {
    if (o.parent_reported_routine) known.push({ label: `Your routine — ${productLabel(o.owned)}`, value: o.parent_reported_routine, source: "parent_reported" });
    if (o.official_instructions && o.product) {
      known.push({ label: `Official instruction — ${o.product.variant_name}`, value: o.official_instructions, source: "verified_product", source_url: o.product.official_url });
    }
    if (o.product && o.age_check) known.push({ label: `Stated age band — ${o.product.variant_name}`, value: `${o.product.age_guidance_text ?? "not stated"} · ${o.age_check.message}`, source: "verified_product", source_url: o.product.official_url });
  }

  /* ---------- Concerns (reported, never diagnosed) ---------- */
  const concerns = profile.concerns.map((c) => ({
    type: c.type,
    name: CONCERN_LABELS[c.type],
    status: NUTRIENT_CONCERNS.includes(c.type) ? `Parent-reported · ${STATUS_LABELS[c.reported_status]} · not clinically assessed by this app` : "Parent-reported",
    nutrient: NUTRIENT_CONCERNS.includes(c.type),
  }));

  /* ---------- Areas worth exploring ---------- */
  const areas: Overview["areas_to_explore"] = [];
  const has = (t: ConcernType) => profile.concerns.some((c) => c.type === t);
  if (has("picky_eating") || profile.refuses.length >= 3)
    areas.push({ title: "Building variety from familiar foods", why: "Small changes to foods your child already accepts — shape, dip, texture — are a low-pressure way to widen the range.", concern: "picky_eating" });
  if (has("fruit_veg"))
    areas.push({ title: "Different ways to offer fruit and vegetables", why: "You mentioned fruit or vegetables are hard. Cooking them into accepted foods, and offering them in new cuts, may be worth trying.", concern: "fruit_veg" });
  if (has("protein_foods")) areas.push({ title: "Everyday protein-containing foods", why: "Dals, curd, paneer, eggs (if eaten) and nut or seed pastes can fit into meals you already make.", concern: "protein_foods" });
  if (has("meal_prep") || profile.prep_time === "5" || profile.prep_time === "10")
    areas.push({ title: "Quicker preparation", why: "You have limited time; no-cook and one-pot ideas can help.", concern: "meal_prep" });
  for (const c of profile.concerns.filter((x) => NUTRIENT_CONCERNS.includes(x.type)))
    areas.push({ title: `Foods that contain ${c.type === "other_nutrient" ? "the nutrient you mentioned" : c.type.replace("_", " ")}`, why: "General food-source education — this is not an assessment of your child's intake.", concern: c.type });
  if (has("appetite")) areas.push({ title: "Low-pressure mealtimes", why: "Regular meal times and small portions are commonly suggested when a child refuses meals.", concern: "appetite" });
  for (const o of owned) {
    if (o.owned.wants_help.length || o.owned.follows_pack_instructions !== "yes")
      areas.push({ title: `Understanding ${o.product?.variant_name ?? productLabel(o.owned)}`, why: o.instructions_status === "verified" ? "Compare your routine with the official instruction, and see verified-compatible ways to serve it." : "We don't have verified instructions for this exact product; the pack is your guide.", concern: "product_question" });
  }
  if (!areas.length) areas.push({ title: "General food ideas", why: "Practical ideas matched to your child's age, diet and allergies.", concern: "general" });

  /* ---------- What we cannot determine ---------- */
  const cannot = [
    "Whether your child has any nutrient deficiency.",
    "Whether any supplement is medically necessary.",
    "Whether your child has an underlying medical condition.",
    "Whether your child's growth or nutritional status is normal.",
    "Whether the reported diet meets every nutritional requirement.",
  ];

  /* ---------- Gaps ---------- */
  const gaps: string[] = [];
  if (!mealBits.length) gaps.push("Typical meals and drinks (approximate is fine).");
  if (!profile.likes.length) gaps.push("A few foods your child reliably accepts.");
  if (!profile.no_known_allergies && !profile.allergies.length) gaps.push("Whether your child has any allergies or intolerances.");
  if (!profile.prep_time) gaps.push("How much time you usually have to prepare food.");
  for (const c of profile.concerns.filter((x) => NUTRIENT_CONCERNS.includes(x.type) && x.reported_status === "not_sure")) gaps.push(`Whether the ${CONCERN_LABELS[c.type].toLowerCase()} is a general worry or something a professional raised (optional).`);
  for (const o of owned.filter((x) => x.instructions_status === "not_verified")) gaps.push(`Verified instructions for ${productLabel(o.owned)} — please refer to its pack.`);

  /* ---------- Professional guidance ---------- */
  const guidance = [...rules.professionalGuidance];
  if (profile.concerns.some((c) => NUTRIENT_CONCERNS.includes(c.type)) && !guidance.length)
    guidance.push("If a nutrient concern persists, a paediatrician or registered dietitian can assess intake properly — this app can't.");
  if (profile.concerns.some((c) => c.professional_instructions_given === "yes"))
    guidance.push("You said a professional has given instructions. Those take priority over anything in this app.");

  /* ---------- Next actions ---------- */
  const firstConcern = areas[0]?.concern ?? "general";
  const actions: Overview["next_actions"] = [{ label: "Explore two or three food ideas", href: `/workspace?concern=${firstConcern}` }];
  if (owned.length) actions.push({ label: "Review your product's official instructions", href: "/workspace?concern=product_question" });
  if (gaps.length) actions.push({ label: "Add missing details to your profile", href: "/onboarding?step=review" });
  if (guidance.length) actions.push({ label: "Read when to involve a professional", href: "#professional" });

  return {
    summary,
    known,
    concerns,
    areas_to_explore: areas,
    cannot_determine: cannot,
    information_gaps: gaps,
    professional_guidance: guidance,
    next_actions: actions,
    calculations_note:
      kb.nutrientReferences.length === 0
        ? "No calculations are shown: no validated, professionally reviewed nutrient reference dataset has been loaded, so we don't score intake or estimate adequacy."
        : "Calculations use the reference values listed with each figure.",
    applied_rules: rules.applied.map((r) => ({ id: r.id, name: r.name })),
  };
}
