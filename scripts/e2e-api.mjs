// End-to-end API checks against a running server.
// Usage: BASE=http://localhost:3100 ADMIN_PASSWORD=... node scripts/e2e-api.mjs
const BASE = process.env.BASE ?? "http://localhost:3000";
const ADMIN = process.env.ADMIN_PASSWORD ?? "";
let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

class Client {
  constructor() { this.jar = new Map(); }
  async req(path, { method, body } = {}) {
    const headers = { "content-type": "application/json" };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(BASE + path, { method: method ?? (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (!v || /max-age=0/i.test(c)) this.jar.delete(k); else this.jar.set(k, v);
    }
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  }
}

const demoA = {
  nickname: "E2E child", age_years: 5, age_months: 2, dietary_pattern: "vegetarian", no_known_allergies: true,
  likes: ["roti", "banana", "curd"], refuses: ["green vegetables"], textures_accepted: ["soft"],
  concerns: [{ type: "product_question", reported_status: "general_concern" }, { type: "calcium", reported_status: "general_concern" }],
  meals: { breakfast: "Nutrimix with milk" }, prep_time: "10",
  products: [{ catalog_product_id: "lj-nutrimix-2-6-chocolate-350g", is_external_unverified: false, brand: "Little Joys", product_name: "Nutrimix", variant: "Chocolate", parent_reported_routine: "1 scoop in warm milk", follows_pack_instructions: "not_sure", wants_help: ["using"] }],
  assistance: ["recipes_with_products"], consent: { persist: false, ai_explanations: false },
};
const milkAllergy = { age_years: 3, age_months: 6, dietary_pattern: "vegetarian_eggs", allergies: [{ allergen: "milk", kind: "allergy", severity: "moderate" }], concerns: [{ type: "calcium", reported_status: "suspected" }], assistance: ["learn_products"] };

const anon = new Client();

// --- Main journey
let r = await anon.req("/api/overview", { body: { profile: demoA } });
check("overview builds from profile", r.status === 200 && /5 years 2 months/.test(r.json?.overview?.summary ?? ""), r.json?.overview?.summary?.slice(0, 80));

r = await anon.req("/api/recommendations", { body: { profile: demoA, concern: "product_question" } });
const recs = r.json;
check("recommendations return ≤3 eligible ideas", r.status === 200 && recs.recipe_recommendations.length > 0 && recs.recipe_recommendations.length <= 3, recs?.recipe_recommendations?.map((c) => c.recipe.id).join(", "));
check("structured output contract fields present", ["profile_summary", "known_information", "reported_concerns", "areas_to_explore", "information_gaps", "general_education", "recipe_recommendations", "product_information", "professional_guidance", "evidence_sources", "disclaimers"].every((k) => k in recs));
check("exact owned variant matched with verified instruction", recs.owned_products[0]?.match === "exact_variant" && /2 scoops \(30 g\)/.test(recs.owned_products[0]?.official_instructions ?? ""));
check("parent routine kept separate", recs.owned_products[0]?.parent_reported_routine === "1 scoop in warm milk");
check("demo mode uses deterministic explanations", recs.generated_by === "deterministic" && /Demo mode/.test(recs.ai_notice ?? ""));
check("no product forced into response", recs.product_information.length === 0);

r = await anon.req("/api/recommendations", { body: { profile: milkAllergy, concern: "calcium" } });
check("milk allergy excludes all milk recipes", r.status === 200 && [...r.json.recipe_recommendations, ...r.json.more_recipes].every((c) => !c.recipe.allergens.includes("milk")));
check("suspected deficiency → referral + products off", r.json.professional_guidance.length > 0 && r.json.product_information.length === 0 && /switched off/.test(r.json.product_information_note ?? ""));

r = await anon.req("/api/recommendations", { body: { profile: { age_years: 1, age_months: 6, dietary_pattern: "vegetarian", concerns: [{ type: "iron" }] }, concern: "iron" } });
check("under-two: no recipes, guidance shown", r.status === 200 && r.json.recipe_recommendations.length === 0 && r.json.general_education.some((e) => e.concern_type === "under_two"));

r = await anon.req("/api/chat", { body: { profile: demoA, message: "How many scoops should I give for more calcium?", concern: "product_question" } });
check("chat refuses dosing, quotes official instruction", r.status === 200 && r.json.kind === "dosing_refusal" && /2 scoops/.test(r.json.answer));
r = await anon.req("/api/chat", { body: { profile: { ...demoA, dietary_pattern: "vegetarian_eggs" }, message: "Can you show an option without eggs?", concern: "protein_foods" } });
check("chat 'without eggs' re-runs engine", r.status === 200 && r.json.kind === "recipes" && r.json.recipes.every((c) => !c.recipe.allergens.includes("egg")));

// --- Validation / errors
r = await anon.req("/api/recommendations", { body: { profile: { age_years: 30, dietary_pattern: "vegetarian" } } });
check("invalid age rejected with 400 + issues", r.status === 400 && Array.isArray(r.json?.issues));
r = await anon.req("/api/chat", { body: { profile: demoA, message: "" } });
check("empty chat message rejected", r.status === 400);
const bad = await fetch(BASE + "/api/overview", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
check("malformed JSON rejected", bad.status === 400);
r = await anon.req("/api/catalog?q=zzzzzz");
check("empty search handled", r.status === 200 && r.json.total === 0);
r = await anon.req("/api/catalog/does-not-exist");
check("missing product → 404", r.status === 404);

// --- Consent & privacy
r = await anon.req("/api/profiles", { body: { profile: demoA } });
check("saving without consent refused", r.status === 400 && /permission/.test(r.json?.error ?? ""));
const ownerA = new Client(), ownerB = new Client();
r = await ownerA.req("/api/profiles", { body: { profile: { ...demoA, consent: { persist: true, ai_explanations: false } } } });
const idA = r.json?.id;
check("saving with consent works", r.status === 200 && !!idA && ownerA.jar.has("ng_owner"));
r = await ownerA.req(`/api/profiles/${idA}`);
check("owner can read own profile", r.status === 200 && r.json.profile.nickname === "E2E child");
r = await ownerB.req(`/api/profiles/${idA}`);
check("another browser cannot read it", r.status === 404);
r = await anon.req(`/api/profiles/${idA}`);
check("no-cookie request cannot read it", r.status === 404);
const forged = new Client(); forged.jar.set("ng_owner", "someone-else.forgedsignature");
r = await forged.req(`/api/profiles/${idA}`);
check("forged owner cookie rejected", r.status === 404);
r = await ownerB.req(`/api/profiles/${idA}`, { method: "DELETE" });
check("another browser cannot delete it", r.status === 404);
await ownerA.req("/api/saved", { body: { item_type: "recipe", item_id: "vegetable-poha" } });
r = await ownerB.req("/api/saved");
check("saved items isolated per owner", r.json.items.length === 0);
r = await ownerA.req("/api/feedback", { body: { recommendation_type: "recipe", recommendation_id: "vegetable-poha", rating: "helpful", profile_id: idA } });
check("feedback accepted", r.status === 200);
r = await ownerA.req("/api/me", { method: "DELETE" });
check("delete-all removes profile + saved", r.status === 200 && r.json.deleted.profiles === 1 && r.json.deleted.saved === 1);
r = await ownerA.req(`/api/profiles/${idA}`);
check("profile gone after deletion", r.status === 404);

// --- Admin protection
for (const [path, body] of [["/api/admin/kb"], ["/api/admin/entity", { kind: "products", record: {} }], ["/api/admin/status", { kind: "products", id: "x", status: "approved" }], ["/api/admin/ingest", { kind: "all" }]]) {
  r = await anon.req(path, body ? { body } : {});
  check(`anonymous blocked: ${path}`, r.status === 401 || r.status === 503, String(r.status));
}
const admin = new Client();
r = await admin.req("/api/admin/login", { body: { password: "wrong" } });
check("wrong admin password refused", r.status === 401);
if (ADMIN) {
  r = await admin.req("/api/admin/login", { body: { password: ADMIN } });
  check("admin login works", r.status === 200 && admin.jar.has("ng_admin"));
  r = await admin.req("/api/admin/kb");
  check("admin can read KB, imports, change log", r.status === 200 && r.json.kb.products.length > 0 && Array.isArray(r.json.changeLog));
  r = await admin.req("/api/admin/status", { body: { kind: "recipes", id: "vegetable-poha", status: "approved" } });
  check("invalid status for entity rejected", r.status >= 400);
  r = await admin.req("/api/admin/entity", { body: { kind: "products", record: { id: "BAD ID" } } });
  check("invalid record rejected by schema", r.status === 400);
  const kb = (await admin.req("/api/admin/kb")).json.kb;
  const poha = kb.recipes.find((x) => x.id === "vegetable-poha");
  r = await admin.req("/api/admin/entity", { body: { kind: "recipes", record: { ...poha, prep_time_minutes: 6 } } });
  check("admin edit saved", r.status === 200 && r.json.changes >= 1);
  r = await admin.req("/api/admin/kb");
  check("edit recorded in change log", r.json.changeLog.some((e) => e.entity_id === "vegetable-poha" && e.field === "prep_time_minutes"));
  await admin.req("/api/admin/entity", { body: { kind: "recipes", record: poha } }); // restore
  r = await admin.req("/api/admin/ingest", { body: { kind: "product", productId: "lj-nutrimix-2-6-chocolate-350g" } });
  const live = r.json?.results?.[0];
  check("live ingestion attempt completes without corrupting data", r.status === 200, `status=${live?.status} error=${live?.error ?? "none"}`);
  r = await admin.req("/api/admin/kb");
  const nm = r.json.kb.products.find((p) => p.id === "lj-nutrimix-2-6-chocolate-350g");
  check("approved instruction unchanged after ingestion", /2 scoops \(30 g\)/.test(nm.official_instructions.text), `review_status=${nm.review_status}`);
  await admin.req("/api/admin/logout", { method: "POST" });
  r = await admin.req("/api/admin/kb");
  check("admin logout ends session", r.status === 401);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
