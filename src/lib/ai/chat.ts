/**
 * Contextual assistant. Every answer is grounded in the same deterministic engine:
 *  1. Safety guards run first (emergency, diagnosis, dosing) and cannot be bypassed.
 *  2. Intents that need data ("without eggs", "another breakfast") re-run the engine.
 *  3. Optionally, an LLM rephrases the grounded answer; its output is validated and
 *     may only reference recipes the engine returned.
 */
import type { ChildProfile, ConcernType, MealType } from "../schemas";
import type { KnowledgeBase } from "../kb";
import { recommend, type ContentMode, type RecipeCard, type RecommendationResult } from "../engine/recommend";
import { callLlm, type FetchLike, type LlmConfig } from "./provider";
import { validateChat } from "./validate";

export type ChatKind =
  | "emergency"
  | "diagnosis_refusal"
  | "dosing_refusal"
  | "recipes"
  | "why"
  | "missing_info"
  | "instructions"
  | "ingredient"
  | "general";

export interface ChatContext {
  concern: ConcernType | "general";
  contentMode: ContentMode;
  shownRecipeIds: string[];
  offset?: number;
}

export interface ChatReply {
  kind: ChatKind;
  answer: string;
  recipes: RecipeCard[];
  generated_by: "llm" | "deterministic";
  sources: { title: string; url: string }[];
}

const EMERGENCY = /\b(not breathing|can'?t breathe|trouble breathing|difficulty breathing|wheez\w*|turning blue|blue lips|unconscious|unresponsive|won'?t wake|anaphyla\w*|choking|seizure|convulsion|blood in (the )?(stool|poo|vomit)|swallowed (a lot|many|the whole|lots|the bottle|all)|overdose|poison\w*)\b|\b(lips?|face|tongue|throat|eyes?|mouth)\b.{0,25}\b(swell\w*|swollen|puff\w*)|\b(swell\w*|swollen)\b.{0,25}\b(lips?|face|tongue|throat|eyes?|mouth)\b/i;
const DIAGNOSIS = /\b(diagnos\w*|(is|does|could|might) (my|the) (child|son|daughter|kid|baby|toddler)\b.{0,40}\b(deficien\w*|anaemi\w*|anemi\w*|allerg\w*|intoleran\w*|sick|ill|disorder|disease|normal|underweight|overweight)|(is|are) (he|she|they)\b.{0,20}\b(deficien\w*|anaemi\w*|anemi\w*|underweight)|does (he|she|they) have)\b/i;
const DOSING = /\b(how (much|many)|what (dose|amount)|dosage|dose|how often|times a day|per day)\b.{0,50}\b(give|take|gummies|gummy|scoops?|supplements?|vitamins?|iron|calcium|nutrimix|tablets?|syrup|drops|product)\b|\b(increase|double|extra|more)\b.{0,15}\b(scoops?|dose|serving|gummies)\b|\b(can|should) i (give|add|combine)\b.{0,40}\b(supplement|gummies|vitamin|iron|calcium|two products|both)\b/i;
const WITHOUT = /(?:\b(?:without|free of|avoid(?:ing)?|minus|with no)|^no)\s+([a-z][a-z\s-]{1,25}?)(?:\s+(?:option|options|idea|ideas|recipe|recipes|please|for|in it))?[?.!]*$|\b([a-z]+)[- ]free\b/i;
const ANOTHER = /\b(another|other|more|different|new|else|alternative)\b.{0,30}\b(idea|ideas|option|options|recipe|recipes|breakfast|lunch|dinner|snack|drink|suggestion)s?\b|\b(suggest|show)\b.{0,20}\b(breakfast|lunch|dinner|snack|drink)\b/i;
const WHY = /\bwhy\b.{0,40}\b(suggest|recommend|show|pick|choose|this|these)\w*/i;
const MISSING = /\b(missing|what (information|info|details)|what else (do you|should i)|information gaps?|what don'?t you know)\b/i;
const INSTRUCTIONS = /\b(instruction|instructions|label|how (do|should|to) (i )?(use|prepare|make|mix|serve)|serving size|pack says)\b/i;
const INGREDIENT = /\b(what is|what's|what are|explain|tell me about)\b\s+(?:the\s+)?(?:ingredient\s+)?([a-z][a-z\s()-]{2,40}?)[?.!]*$/i;

const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "drink"];

/** Short, factual glossary drawn from the stored product pages and education records. */
const GLOSSARY: { match: RegExp; text: string; source?: string }[] = [
  { match: /chicory|inulin/i, text: "Chicory root powder (inulin) is a plant fibre. Little Joys describes it as a prebiotic that supports gut health — that is the manufacturer's description, not an independent clinical claim.", source: "src-lj-nutrimix-2-6" },
  { match: /jaggery|gur\b/i, text: "Jaggery (gur) is a traditional, less refined sweetener made from sugarcane. It is still a sugar.", source: "src-lj-nutrimix-2-6" },
  { match: /ragi|finger millet/i, text: "Ragi is finger millet, a whole grain commonly used in Indian cooking (porridge, rotis, dosas).", source: "src-lj-nutrimix-2-6" },
  { match: /bajra|pearl millet/i, text: "Bajra is pearl millet, a whole grain.", source: "src-lj-nutrimix-2-6" },
  { match: /jowar|sorghum/i, text: "Jowar is sorghum, a whole grain.", source: "src-lj-nutrimix-2-6" },
  { match: /\bdha\b|omega/i, text: "DHA is an omega-3 fatty acid. Little Joys states the DHA in Nutrimix 2–6 comes from an algal source; the amount per serving isn't in our verified record.", source: "src-lj-nutrimix-2-6" },
  { match: /vitamin d3|cholecalciferol/i, text: "Vitamin D3 (cholecalciferol) is a form of vitamin D. The body also makes vitamin D when bare skin is exposed to sunlight. Too much vitamin D, almost always from supplements, can be harmful.", source: "src-ods-vitamin-d" },
  { match: /besan|gram flour|chickpea/i, text: "Besan is gram (chickpea) flour — a legume flour used for cheela, pakoras and more." },
  { match: /lactose/i, text: "Lactose is the natural sugar in milk. Lactose intolerance is different from a milk allergy, which is an immune reaction to milk proteins. Little Joys notes its lactose-free Nutrimix still contains other milk allergens.", source: "src-lj-nutrimix-lactose-free" },
  { match: /ghee/i, text: "Ghee is clarified butter. It is made from milk, so this app treats it as a milk ingredient for allergy filtering." },
];

function sourceList(kb: KnowledgeBase, ids: (string | undefined)[]) {
  return ids.filter(Boolean).map((id) => kb.sources.find((s) => s.id === id)).filter(Boolean).map((s) => ({ title: s!.title, url: s!.url }));
}

function recipesLine(cards: RecipeCard[]) {
  return cards.map((c) => `• ${c.recipe.name} (${c.recipe.prep_time_minutes + c.recipe.cook_time_minutes} min · ${c.evidence_label})`).join("\n");
}

/** Deterministic grounded answer. Always available; also the context given to the LLM. */
export function groundedReply(profile: ChildProfile, message: string, ctx: ChatContext, kb: KnowledgeBase, current?: RecommendationResult): ChatReply {
  const msg = message.trim();
  const base = current ?? recommend(profile, { concern: ctx.concern, contentMode: ctx.contentMode }, kb);
  const reply = (kind: ChatKind, answer: string, recipes: RecipeCard[] = [], sources: ChatReply["sources"] = []): ChatReply => ({ kind, answer, recipes, generated_by: "deterministic", sources });

  if (EMERGENCY.test(msg)) {
    return reply("emergency", "This sounds like it could be urgent. If your child is having trouble breathing, has swelling of the face, lips or throat, is unresponsive, or may have swallowed medicines or supplements, call emergency services now (112 in India) or go to the nearest emergency department. This app can't help with emergencies.");
  }
  if (DOSING.test(msg)) {
    const owned = base.owned_products.filter((o) => o.official_instructions);
    const instr = owned.map((o) => `${o.product!.variant_name}: “${o.official_instructions}” (official page)`).join("\n");
    return reply(
      "dosing_refusal",
      `I can't advise how much of a supplement or product to give, how often, or whether to combine products — that depends on your child and needs a paediatrician or pharmacist.${instr ? `\n\nWhat I can show is the official instruction we've verified:\n${instr}\n\nThe pack instruction applies; please don't increase it without professional advice.` : ""}`,
      [],
      sourceList(kb, owned.flatMap((o) => o.product!.source_ids.slice(0, 1))),
    );
  }
  if (DIAGNOSIS.test(msg)) {
    return reply(
      "diagnosis_refusal",
      "I can't tell whether your child has a deficiency, allergy or medical condition — a questionnaire can't show that, and a paediatrician may need to examine your child or order tests. What I can do is share general food information and help you note down what to ask. Would that help?",
    );
  }

  const without = msg.match(WITHOUT);
  if (without) {
    const term = (without[1] ?? without[2] ?? "").trim().replace(/s$/, "");
    const r = recommend(profile, { concern: ctx.concern, contentMode: ctx.contentMode, avoid: [term] }, kb);
    const cards = r.recipes.length ? r.recipes : r.more_recipes;
    return reply(
      "recipes",
      cards.length
        ? `Here are ideas without ${term} that still pass your child's age, diet and allergy checks:\n${recipesLine(cards)}\n\nPlease still check every label — we match by the ingredients we hold.`
        : `I couldn't find an idea without ${term} that passes all of your child's checks in our current dataset. I won't make one up — try another filter, or ask your dietitian.`,
      cards,
    );
  }

  if (ANOTHER.test(msg)) {
    const meal = MEALS.find((m) => msg.toLowerCase().includes(m));
    const r = recommend(profile, { concern: ctx.concern, contentMode: ctx.contentMode, mealType: meal, offset: meal ? 0 : (ctx.offset ?? 0) + 3 }, kb);
    const shown = new Set(ctx.shownRecipeIds);
    let cards = [...r.recipes, ...r.more_recipes].filter((c) => !shown.has(c.recipe.id)).slice(0, 3);
    if (!cards.length && meal) cards = r.recipes;
    return reply(
      "recipes",
      cards.length ? `Here ${cards.length === 1 ? "is another idea" : "are some other ideas"}${meal ? ` for ${meal}` : ""}:\n${recipesLine(cards)}` : `That's every idea in our current dataset that fits your child's profile${meal ? ` for ${meal}` : ""}. We don't invent extra recipes to fill the list.`,
      cards,
    );
  }

  if (WHY.test(msg)) {
    const shown = base.recipes.filter((c) => !ctx.shownRecipeIds.length || ctx.shownRecipeIds.includes(c.recipe.id));
    if (!shown.length) return reply("why", "There aren't any ideas on screen right now to explain.");
    const lines = shown.map((c) => `• ${c.recipe.name}: ${c.relevance.join(" ")} It passed the age check (${c.age_check.message.toLowerCase()}) and allergy check (${c.allergen_check.message.toLowerCase()})`);
    return reply("why", `Each idea is picked by fixed rules — not by an AI and not by commercial value:\n${lines.join("\n")}`, []);
  }

  if (MISSING.test(msg)) {
    const gaps = base.information_gaps;
    return reply("missing_info", gaps.length ? `A few things would help:\n${gaps.map((g) => `• ${g}`).join("\n")}\n\nYou can add them from your profile at any time.` : "Your profile covers what we need for food ideas. We still can't assess nutrient intake or health — that needs a professional.");
  }

  if (INSTRUCTIONS.test(msg)) {
    if (!base.owned_products.length) return reply("instructions", "You haven't added any products to your profile. Add one (exact variant and flavour) and I can show its verified official instructions where we have them.");
    const lines = base.owned_products.map((o) =>
      o.official_instructions
        ? `• ${o.product!.variant_name}: “${o.official_instructions}” — in plain words: ${plainInstruction(o.official_instructions)}`
        : `• ${o.owned.product_name}${o.owned.variant ? ` (${o.owned.variant})` : ""}: we haven't verified the official instructions for this exact variant. Please follow the pack.`,
    );
    return reply("instructions", `${lines.join("\n")}\n\nI explain the instruction but never change the amount. Questions about how much your child should have belong with a paediatrician.`, [], sourceList(kb, base.owned_products.flatMap((o) => o.product?.source_ids.slice(0, 1) ?? [])));
  }

  const ing = msg.match(INGREDIENT);
  if (ing) {
    const term = ing[2].trim();
    const g = GLOSSARY.find((x) => x.match.test(term));
    if (g) return reply("ingredient", g.text, [], sourceList(kb, [g.source]));
    if (/^(this|that|the|an?)\b|^(it|ingredients?)$/i.test(term)) {
      return reply("ingredient", "Which ingredient would you like explained? I have short, sourced notes on: chicory root (inulin), jaggery, ragi, bajra, jowar, DHA, vitamin D3, besan, lactose and ghee.");
    }
    return reply("ingredient", `I don't have a reviewed explanation for "${term}" yet. The product's official page or your dietitian are the best places to check.`);
  }

  return reply(
    "general",
    `I can help with: another idea (e.g. "another breakfast idea"), options without an ingredient ("an option without eggs"), why an idea was suggested, what information is missing, or explaining a product's official instructions. Currently showing ideas for: ${base.concern_label.toLowerCase()}.`,
  );
}

function plainInstruction(text: string): string {
  const m = text.match(/(\d+)\s*scoops?\s*\((\d+)\s*g\)[^\d]*(\d+)\s*ml/i);
  if (!m) return "follow the pack wording exactly; it is the governing instruction.";
  const liquid = /water/i.test(text) ? "water" : "milk";
  const temp = /lukewarm or cold/i.test(text) ? " The milk should be lukewarm or cold (the pack doesn't mention hot milk)." : "";
  return `one serving is ${m[1]} scoops (${m[2]} g) mixed into ${m[3]} ml of ${liquid}.${temp}`;
}

const CHAT_SYSTEM = `You rephrase a GROUNDED ANSWER for a parent in a warmer, clearer way. You must not add facts, quantities, products, diagnoses, dosing, outcome promises or safety guarantees beyond the grounded answer. Keep any refusal or referral intact. You may only list recipe_ids from the grounded answer. Return ONLY JSON: {"answer": string, "recipe_ids": string[]}.`;

export async function answerChat(
  profile: ChildProfile,
  message: string,
  ctx: ChatContext,
  kb: KnowledgeBase,
  opts: { llm: LlmConfig | null; consent: boolean; fetchImpl?: FetchLike },
): Promise<ChatReply> {
  const grounded = groundedReply(profile, message, ctx, kb);
  // Safety-critical replies are never rephrased.
  if (["emergency", "diagnosis_refusal", "dosing_refusal"].includes(grounded.kind)) return grounded;
  if (!opts.llm || !opts.consent) return grounded;
  try {
    const corpus = JSON.stringify({ grounded_answer: grounded.answer, recipes: grounded.recipes.map((c) => ({ id: c.recipe.id, name: c.recipe.name })) });
    const raw = await callLlm(opts.llm, { system: CHAT_SYSTEM, user: `Parent asked: ${JSON.stringify(message.slice(0, 500))}\nGrounded answer and allowed recipes:\n${corpus}`, maxTokens: 600 }, opts.fetchImpl);
    const v = validateChat(raw, { recipeIds: new Set(grounded.recipes.map((c) => c.recipe.id)), corpus });
    if (!v.ok || !v.value) return grounded;
    const order = v.value.recipe_ids.length ? v.value.recipe_ids : grounded.recipes.map((c) => c.recipe.id);
    const recipes = order.map((id) => grounded.recipes.find((c) => c.recipe.id === id)!).filter(Boolean);
    return { ...grounded, answer: v.value.answer, recipes, generated_by: "llm" };
  } catch {
    return grounded;
  }
}
