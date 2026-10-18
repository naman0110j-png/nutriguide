/**
 * Supabase repository. Runs server-side with the service-role key and ALWAYS scopes
 * parent-data queries by owner_id in code. RLS policies (see migration) additionally
 * restrict any direct client access to auth.uid() = owner_id.
 *
 * Status: implemented against the schema in supabase/migrations and type-checked; the
 * SQL itself is tested on embedded Postgres, but this client code has NOT been run
 * against a live Supabase project in this build (no credentials were available).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { KnowledgeBase } from "../kb";
import type { ChangeLogEntry, ChildProfile, Feedback, ProductImport, SavedItem } from "../schemas";
import { ChildProfileSchema } from "../schemas";
import { diffRecords } from "./diff";
import { ENTITY_SCHEMAS, ENTITY_STATUSES, type EntityKind, type Repository, type StoredFeedback, type StoredProfile, type StoredSaved } from "./types";

const TABLE: Record<EntityKind, string> = {
  products: "products",
  recipes: "recipes",
  recipeProducts: "recipe_products",
  education: "concern_education",
  concernProductRules: "concern_product_rules",
  recommendationRules: "recommendation_rules",
  sources: "evidence_sources",
};

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Database error: ${res.error.message}`);
  return res.data as T;
}

/* ---------- profile <-> rows ---------- */

function profileToRow(ownerId: string, p: ChildProfile) {
  return {
    owner_id: ownerId,
    nickname: p.nickname ?? null,
    age_years: p.age_years,
    age_months: p.age_months,
    gender: p.gender ?? null,
    dietary_pattern: p.dietary_pattern,
    dietary_other: p.dietary_other ?? null,
    food_preferences: { likes: p.likes, textures_accepted: p.textures_accepted, available_ingredients: p.available_ingredients },
    food_aversions: { refuses: p.refuses, textures_refused: p.textures_refused, eating_difficulties: p.eating_difficulties ?? null },
    meal_routine: { ...p.meals, eats_outside: p.eats_outside ?? null, prep_time: p.prep_time ?? null, cooking_complexity: p.cooking_complexity ?? null },
    assistance: { assistance: p.assistance, assistance_other: p.assistance_other ?? null, no_known_allergies: p.no_known_allergies },
    consent: p.consent,
  };
}

type Row = Record<string, unknown> & { id: string; owner_id: string; created_at: string; updated_at: string };

function rowsToProfile(row: Row, allergies: Record<string, unknown>[], concerns: Record<string, unknown>[], products: Record<string, unknown>[]): ChildProfile {
  const fp = (row.food_preferences ?? {}) as Record<string, unknown>;
  const fa = (row.food_aversions ?? {}) as Record<string, unknown>;
  const mr = (row.meal_routine ?? {}) as Record<string, unknown>;
  const as = (row.assistance ?? {}) as Record<string, unknown>;
  const nn = <T>(v: unknown) => (v === null ? undefined : (v as T));
  return ChildProfileSchema.parse({
    id: row.id,
    nickname: nn(row.nickname),
    age_years: row.age_years,
    age_months: row.age_months,
    gender: nn(row.gender),
    dietary_pattern: row.dietary_pattern,
    dietary_other: nn(row.dietary_other),
    no_known_allergies: !!as.no_known_allergies,
    allergies: allergies.map((a) => ({ allergen: a.ingredient_or_allergen, label: nn(a.label), kind: a.kind, severity: nn(a.severity), reaction_details: nn(a.reaction_details), source: "parent_reported" })),
    likes: fp.likes ?? [],
    textures_accepted: fp.textures_accepted ?? [],
    available_ingredients: fp.available_ingredients ?? [],
    refuses: fa.refuses ?? [],
    textures_refused: fa.textures_refused ?? [],
    eating_difficulties: nn(fa.eating_difficulties),
    concerns: concerns.map((c) => ({ type: c.concern_type, parent_description: nn(c.parent_description), reported_status: c.reported_status, professional_instructions_given: nn(c.professional_assessment_status), professional_instructions_text: nn(c.professional_instructions_text) })),
    meals: { breakfast: nn(mr.breakfast), lunch: nn(mr.lunch), dinner: nn(mr.dinner), snacks: nn(mr.snacks), beverages: nn(mr.beverages) },
    eats_outside: nn(mr.eats_outside),
    prep_time: nn(mr.prep_time),
    cooking_complexity: nn(mr.cooking_complexity),
    products: products.map((p) => ({ catalog_product_id: p.catalog_product_id ?? null, is_external_unverified: p.is_external_unverified, brand: p.brand, product_name: p.product_name, variant: nn(p.variant), age_variant: nn(p.age_variant), frequency: nn(p.frequency), parent_reported_routine: nn(p.parent_reported_routine), follows_pack_instructions: p.follows_pack_instructions, difficulties: nn(p.difficulties), wants_help: p.wants_help ?? [] })),
    assistance: as.assistance ?? [],
    assistance_other: nn(as.assistance_other),
    consent: row.consent ?? { persist: true, ai_explanations: false },
  });
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async getKnowledgeBase(): Promise<KnowledgeBase> {
    const [sources, products, recipes, recipeProducts, concernCatalog, education, concernProductRules, recommendationRules, nutrientReferences] = await Promise.all([
      this.db.from("evidence_sources").select("*"),
      this.db.from("products").select("*"),
      this.db.from("recipes").select("*"),
      this.db.from("recipe_products").select("*"),
      this.db.from("concern_catalog").select("*"),
      this.db.from("concern_education").select("*"),
      this.db.from("concern_product_rules").select("*"),
      this.db.from("recommendation_rules").select("*"),
      this.db.from("nutrient_references").select("*"),
    ]);
    return {
      sources: must(sources),
      products: must(products),
      recipes: must(recipes),
      recipeProducts: must(recipeProducts),
      concernCatalog: must(concernCatalog),
      education: must(education),
      concernProductRules: must(concernProductRules),
      recommendationRules: must(recommendationRules),
      nutrientReferences: must(nutrientReferences),
    } as unknown as KnowledgeBase;
  }

  private async writeChildren(profileId: string, p: ChildProfile) {
    must(await this.db.from("profile_allergies").delete().eq("profile_id", profileId));
    must(await this.db.from("parent_concerns").delete().eq("profile_id", profileId));
    must(await this.db.from("profile_products").delete().eq("profile_id", profileId));
    if (p.allergies.length) must(await this.db.from("profile_allergies").insert(p.allergies.map((a) => ({ profile_id: profileId, ingredient_or_allergen: a.allergen, label: a.label ?? null, kind: a.kind, severity: a.severity ?? null, reaction_details: a.reaction_details ?? null, source: "parent_reported" }))));
    if (p.concerns.length) must(await this.db.from("parent_concerns").insert(p.concerns.map((c) => ({ profile_id: profileId, concern_type: c.type, parent_description: c.parent_description ?? null, reported_status: c.reported_status, professional_assessment_status: c.professional_instructions_given ?? null, professional_instructions_text: c.professional_instructions_text ?? null }))));
    if (p.products.length) must(await this.db.from("profile_products").insert(p.products.map((x) => ({ profile_id: profileId, catalog_product_id: x.catalog_product_id, is_external_unverified: x.is_external_unverified, brand: x.brand, product_name: x.product_name, variant: x.variant ?? null, age_variant: x.age_variant ?? null, frequency: x.frequency ?? null, parent_reported_routine: x.parent_reported_routine ?? null, follows_pack_instructions: x.follows_pack_instructions, difficulties: x.difficulties ?? null, wants_help: x.wants_help }))));
  }

  async saveProfile(ownerId: string, profile: ChildProfile, id?: string): Promise<StoredProfile> {
    let row: Row;
    if (id) {
      const existing = must(await this.db.from("child_profiles").select("id").eq("id", id).eq("owner_id", ownerId).maybeSingle());
      if (existing) {
        row = must(await this.db.from("child_profiles").update(profileToRow(ownerId, profile)).eq("id", id).eq("owner_id", ownerId).select().single()) as Row;
        await this.writeChildren(row.id, profile);
        return (await this.getProfile(ownerId, row.id))!;
      }
    }
    row = must(await this.db.from("child_profiles").insert(profileToRow(ownerId, profile)).select().single()) as Row;
    await this.writeChildren(row.id, profile);
    return (await this.getProfile(ownerId, row.id))!;
  }

  async getProfile(ownerId: string, id: string): Promise<StoredProfile | null> {
    const row = must(await this.db.from("child_profiles").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle()) as Row | null;
    if (!row) return null;
    const [a, c, p] = await Promise.all([
      this.db.from("profile_allergies").select("*").eq("profile_id", id),
      this.db.from("parent_concerns").select("*").eq("profile_id", id),
      this.db.from("profile_products").select("*").eq("profile_id", id),
    ]);
    return { id: row.id, owner_id: row.owner_id, profile: rowsToProfile(row, must(a), must(c), must(p)), created_at: row.created_at, updated_at: row.updated_at };
  }

  async listProfiles(ownerId: string) {
    const rows = must(await this.db.from("child_profiles").select("id").eq("owner_id", ownerId)) as { id: string }[];
    const out = await Promise.all(rows.map((r) => this.getProfile(ownerId, r.id)));
    return out.filter(Boolean) as StoredProfile[];
  }

  async deleteProfile(ownerId: string, id: string) {
    const del = must(await this.db.from("child_profiles").delete().eq("id", id).eq("owner_id", ownerId).select("id")) as unknown[];
    return del.length > 0;
  }

  async deleteAllOwnerData(ownerId: string) {
    const profiles = must(await this.db.from("child_profiles").delete().eq("owner_id", ownerId).select("id")) as unknown[];
    const saved = must(await this.db.from("saved_items").delete().eq("owner_id", ownerId).select("id")) as unknown[];
    return { profiles: profiles.length, saved: saved.length };
  }

  async listSaved(ownerId: string) {
    return must(await this.db.from("saved_items").select("*").eq("owner_id", ownerId)) as StoredSaved[];
  }

  async addSaved(ownerId: string, item: SavedItem) {
    return must(await this.db.from("saved_items").upsert({ owner_id: ownerId, item_type: item.item_type, item_id: item.item_id, note: item.note ?? null }, { onConflict: "owner_id,item_type,item_id" }).select().single()) as StoredSaved;
  }

  async removeSaved(ownerId: string, id: string) {
    const del = must(await this.db.from("saved_items").delete().eq("id", id).eq("owner_id", ownerId).select("id")) as unknown[];
    return del.length > 0;
  }

  async addFeedback(profileId: string | null, fb: Feedback) {
    return must(await this.db.from("recommendation_feedback").insert({ ...fb, profile_id: profileId }).select().single()) as StoredFeedback;
  }

  async listFeedback() {
    return must(await this.db.from("recommendation_feedback").select("*").order("created_at", { ascending: false }).limit(500)) as StoredFeedback[];
  }

  async upsertEntity(kind: EntityKind, record: unknown, actor: string, sourceId: string | null = null) {
    const parsed = ENTITY_SCHEMAS[kind].parse(record) as unknown as { id: string } & Record<string, unknown>;
    const prev = must(await this.db.from(TABLE[kind]).select("*").eq("id", parsed.id).maybeSingle()) as Record<string, unknown> | null;
    const saved = must(await this.db.from(TABLE[kind]).upsert(parsed).select().single()) as Record<string, unknown>;
    const changes = diffRecords(kind, parsed.id, prev ?? undefined, saved, actor, sourceId);
    await this.appendChangeLog(changes);
    return { record: saved, changes };
  }

  async setEntityStatus(kind: EntityKind, id: string, status: string, actor: string) {
    if (!ENTITY_STATUSES[kind].includes(status)) throw new Error(`Invalid status '${status}' for ${kind}`);
    const prev = must(await this.db.from(TABLE[kind]).select("*").eq("id", id).single()) as Record<string, unknown>;
    const patch: Record<string, unknown> = { review_status: status };
    if (kind === "products") {
      patch.last_reviewed_at = new Date().toISOString();
      patch.reviewed_by = actor;
      if (status !== "approved") patch.recommendation_eligible = false;
    }
    const next = must(await this.db.from(TABLE[kind]).update(patch).eq("id", id).select().single()) as Record<string, unknown>;
    await this.appendChangeLog(diffRecords(kind, id, prev, next, actor));
    return next;
  }

  async listChangeLog(limit = 200) {
    return must(await this.db.from("content_change_log").select("*").order("changed_at", { ascending: false }).limit(limit)) as ChangeLogEntry[];
  }

  async appendChangeLog(entries: ChangeLogEntry[]) {
    if (!entries.length) return;
    must(await this.db.from("content_change_log").insert(entries.map(({ id: _id, ...e }) => e)));
  }

  async listImports() {
    return must(await this.db.from("product_imports").select("*").order("fetched_at", { ascending: false }).limit(200)) as ProductImport[];
  }

  async saveImport(imp: ProductImport) {
    return must(await this.db.from("product_imports").upsert(imp).select().single()) as ProductImport;
  }

  async getImport(id: string) {
    return must(await this.db.from("product_imports").select("*").eq("id", id).maybeSingle()) as ProductImport | null;
  }
}
