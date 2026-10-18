import { describe, expect, it, vi } from "vitest";
import { explain, SYSTEM_PROMPT, buildEvidenceBundle } from "@/lib/ai/explain";
import { answerChat, groundedReply } from "@/lib/ai/chat";
import { lintText, validateExplanation } from "@/lib/ai/validate";
import { callLlm, type LlmConfig } from "@/lib/ai/provider";
import { recommend } from "@/lib/engine/recommend";
import { buildOverview } from "@/lib/engine/overview";
import { kb, demo, profile, ownsNutrimix } from "./helpers";

const llm: LlmConfig = { provider: "anthropic", apiKey: "test-key", model: "test-model", baseUrl: null, timeoutMs: 500 };

function anthropicReply(obj: unknown) {
  return new Response(JSON.stringify({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }), { status: 200 });
}

function setup(key = "five-veg-nutrimix", concern: "product_question" | "picky_eating" = "product_question") {
  const k = kb();
  const p = { ...demo(key), consent: { persist: false, ai_explanations: true } };
  const result = recommend(p, { concern, contentMode: "demo" }, k);
  const overview = buildOverview(p, k);
  return { k, p, result, overview };
}

const goodOutput = (result: ReturnType<typeof recommend>) => ({
  profile_summary: "You told us your child is five and enjoys roti, dal rice and banana.",
  recipe_notes: result.recipes.map((c) => ({ recipe_id: c.recipe.id, relevance_explanation: `A different way to serve something familiar: ${c.recipe.name}.` })),
  product_notes: [],
  education_summary: "Small, low-pressure changes to familiar foods are a common starting point.",
  information_gaps: [],
  closing_note: "These are practical ideas, not medical advice.",
});

describe("safety linter", () => {
  const corpus = "2 scoops (30 g) of the nutrition powder with 200 ml of lukewarm or cold milk";
  it.each([
    ["Your child may be deficient in calcium.", "diagnosis"],
    ["This smoothie treats picky eating.", "treatment_claim"],
    ["It will boost immunity and growth.", "outcome_promise"],
    ["You should start giving calcium gummies daily.", "prescription"],
    ["Add an extra scoop for more protein.", "serving_change"],
    ["Use it instead of breakfast on busy days.", "meal_replacement"],
    ["A high-protein, iron-rich breakfast.", "unsupported_nutrient_label"],
    ["This is completely safe for allergies.", "safety_guarantee"],
    ["Give 500 mg each day.", "unsourced_quantity"],
  ])("rejects: %s", (text, rule) => {
    expect(lintText(text, corpus).map((v) => v.rule)).toContain(rule);
  });

  it("allows quantities that appear in the provided facts", () => {
    expect(lintText("One serving is 2 scoops (30 g) in 200 ml of milk.", corpus)).toEqual([]);
  });

  it("allows ordinary practical language", () => {
    expect(lintText("Blending it with banana changes the texture, which some children enjoy.", corpus)).toEqual([]);
  });
});

describe("structured output validation", () => {
  it("accepts schema-valid, safe output", () => {
    const { result } = setup();
    const v = validateExplanation(JSON.stringify(goodOutput(result)), { recipeIds: new Set(result.recipes.map((c) => c.recipe.id)), productIds: new Set(), corpus: "" });
    expect(v.ok).toBe(true);
  });

  it("rejects unknown recipe and product ids (model cannot add ineligible results)", () => {
    const { result } = setup();
    const out = goodOutput(result);
    out.recipe_notes.push({ recipe_id: "egg-bhurji-roti", relevance_explanation: "Try this." });
    (out.product_notes as unknown[]).push({ product_id: "lj-calcium-gummies-strawberry-4-6-30n", relevance_explanation: "Contains calcium." });
    const v = validateExplanation(JSON.stringify(out), { recipeIds: new Set(result.recipes.map((c) => c.recipe.id)), productIds: new Set(), corpus: "" });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/unknown_recipe_id: egg-bhurji-roti/);
    expect(v.errors.join(" ")).toMatch(/unknown_product_id/);
  });

  it("rejects missing required fields and non-JSON", () => {
    expect(validateExplanation('{"profile_summary": "x"}', { recipeIds: new Set(), productIds: new Set(), corpus: "" }).ok).toBe(false);
    expect(validateExplanation("Sure! Here are some ideas.", { recipeIds: new Set(), productIds: new Set(), corpus: "" }).ok).toBe(false);
  });
});

describe("explain() pipeline", () => {
  it("uses the LLM output when valid", async () => {
    const { p, result, overview } = setup();
    const fetchImpl = vi.fn(async () => anthropicReply(goodOutput(result)));
    const out = await explain(p, result, overview, { llm, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.generated_by).toBe("llm");
    expect(out.explanation.recipe_notes.map((n) => n.recipe_id)).toEqual(result.recipes.map((c) => c.recipe.id));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once with feedback, then falls back to deterministic text on repeated unsafe output", async () => {
    const { p, result, overview } = setup();
    const unsafe = { ...goodOutput(result), education_summary: "Nutrimix will boost immunity and treat deficiency." };
    const fetchImpl = vi.fn(async () => anthropicReply(unsafe));
    const out = await explain(p, result, overview, { llm, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out.generated_by).toBe("deterministic");
    expect(out.notice).toMatch(/safety checks/);
    expect(out.explanation.education_summary).not.toMatch(/boost/);
    const secondCall = (fetchImpl.mock.calls[1] as unknown[])[1] as { body: string };
    expect(JSON.parse(secondCall.body).messages[0].content).toMatch(/rejected for/);
  });

  it("recovers on the retry when the second answer is valid", async () => {
    const { p, result, overview } = setup();
    const replies = [anthropicReply("not json at all"), anthropicReply(goodOutput(result))];
    const fetchImpl = vi.fn(async () => replies.shift()!);
    const out = await explain(p, result, overview, { llm, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.generated_by).toBe("llm");
    expect(out.attempts).toBe(2);
  });

  it("stays usable when the provider is down or times out", async () => {
    const { p, result, overview } = setup();
    const down = await explain(p, result, overview, { llm, consent: true, fetchImpl: (async () => new Response("err", { status: 503 })) as unknown as typeof fetch });
    expect(down.generated_by).toBe("deterministic");
    expect(down.explanation.recipe_notes.length).toBe(result.recipes.length);
    const slow = await explain(p, result, overview, {
      llm: { ...llm, timeoutMs: 50 },
      consent: true,
      fetchImpl: ((_u: string, init: { signal: AbortSignal }) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch,
    });
    expect(slow.generated_by).toBe("deterministic");
    expect(slow.notice).toMatch(/timed out/);
  });

  it("does not call the provider without consent or without configuration", async () => {
    const { p, result, overview } = setup();
    const fetchImpl = vi.fn();
    const noConsent = await explain(p, result, overview, { llm, consent: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    const noLlm = await explain(p, result, overview, { llm: null, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(noConsent.generated_by).toBe("deterministic");
    expect(noLlm.notice).toMatch(/Demo mode/);
  });

  it("sends a de-identified bundle (no nickname, no free-text notes) and only eligible records", () => {
    const { p, result } = setup();
    const bundle = JSON.stringify(buildEvidenceBundle(p, result));
    expect(bundle).not.toContain("Demo child A");
    expect(bundle).not.toContain("Gets bored of the same Nutrimix");
    for (const e of result.excluded) expect(bundle).not.toContain(`"recipe_id":"${e.recipe_id}"`);
    expect(SYSTEM_PROMPT).toMatch(/Never diagnose/);
  });

  it("provider adapter sends the key only in the server-side header", async () => {
    const fetchImpl = vi.fn(async () => anthropicReply({ ok: 1 }));
    await callLlm(llm, { system: "s", user: "u" }, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("test-key");
    expect(init.body).not.toContain("test-key");
  });
});

describe("chat assistant", () => {
  const k = kb();
  const p = demo("five-veg-nutrimix");
  const ctx = { concern: "product_question" as const, contentMode: "demo" as const, shownRecipeIds: [] };

  it("refuses diagnosis and refers to a professional", () => {
    const r = groundedReply(p, "Is my child deficient in iron?", ctx, k);
    expect(r.kind).toBe("diagnosis_refusal");
    expect(r.answer).toMatch(/paediatrician/);
  });

  it("refuses dosing but shows the verified official instruction verbatim", () => {
    const r = groundedReply(p, "How many scoops should I give for more calcium?", ctx, k);
    expect(r.kind).toBe("dosing_refusal");
    expect(r.answer).toMatch(/can't advise/);
    expect(r.answer).toMatch(/2 scoops \(30 g\)/);
  });

  it("routes emergencies to emergency services", () => {
    expect(groundedReply(p, "his lips are swelling after eating", ctx, k).kind).toBe("emergency");
  });

  it("'an option without eggs' re-runs the engine with the exclusion", () => {
    const veggs = { ...profile({ dietary_pattern: "vegetarian_eggs" }) };
    const r = groundedReply(veggs, "Can you show an option without eggs?", { ...ctx, concern: "protein_foods" }, k);
    expect(r.kind).toBe("recipes");
    for (const c of r.recipes) expect(c.recipe.allergens).not.toContain("egg");
  });

  it("'another breakfast idea' returns breakfast recipes not already shown", () => {
    const first = recommend(p, { concern: "product_question", contentMode: "demo" }, k);
    const r = groundedReply(p, "Can you suggest another breakfast idea?", { ...ctx, shownRecipeIds: first.recipes.map((c) => c.recipe.id) }, k);
    expect(r.kind).toBe("recipes");
    for (const c of r.recipes) expect(c.recipe.meal_types).toContain("breakfast");
  });

  it("explains why, what's missing, instructions and ingredients", () => {
    expect(groundedReply(p, "Why did you suggest this recipe?", ctx, k).kind).toBe("why");
    expect(groundedReply(p, "What information is missing?", ctx, k).kind).toBe("missing_info");
    const ins = groundedReply(p, "Can you explain the official product instructions?", ctx, k);
    expect(ins.kind).toBe("instructions");
    expect(ins.answer).toMatch(/never change the amount/);
    expect(groundedReply(p, "What is chicory root?", ctx, k).answer).toMatch(/manufacturer/);
  });

  it("never lets the LLM rephrase a safety refusal, and drops unsafe rephrasings", async () => {
    const fetchImpl = vi.fn(async () => anthropicReply({ answer: "Give 3 gummies a day.", recipe_ids: [] }));
    const refusal = await answerChat(p, "How many gummies per day?", ctx, k, { llm, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(refusal.kind).toBe("dosing_refusal");
    expect(fetchImpl).not.toHaveBeenCalled();
    const general = await answerChat(p, "What information is missing?", ctx, k, { llm, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(general.generated_by).toBe("deterministic"); // unsafe rephrase rejected
    expect(general.answer).not.toMatch(/3 gummies/);
  });

  it("LLM rephrasing cannot introduce recipes the engine didn't return", async () => {
    const pp = profile({ ...ownsNutrimix, consent: { persist: false, ai_explanations: true } });
    const fetchImpl = vi.fn(async () => anthropicReply({ answer: "Here are two ideas.", recipe_ids: ["egg-bhurji-roti"] }));
    const r = await answerChat(pp, "another breakfast idea", ctx, k, { llm, consent: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.recipes.map((c) => c.recipe.id)).not.toContain("egg-bhurji-roti");
  });
});

describe("emergency guard coverage", () => {
  const k = kb();
  const p = demo("five-veg-nutrimix");
  const ctx = { concern: "general" as const, contentMode: "demo" as const, shownRecipeIds: [] };
  it.each([
    "his lips are swelling after eating",
    "her face is swollen",
    "swelling around his mouth after peanut",
    "she is wheezing after lunch",
    "he swallowed the whole bottle of gummies",
    "my child is choking",
  ])("treats as emergency: %s", (msg) => {
    expect(groundedReply(p, msg, ctx, k).kind).toBe("emergency");
  });
  it.each(["Does this fit our morning routine?", "another snack idea please"])("does not over-trigger: %s", (msg) => {
    expect(groundedReply(p, msg, ctx, k).kind).not.toBe("emergency");
  });
});
