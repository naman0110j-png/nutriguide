-- =====================================================================
-- Little Joys NutriGuide — initial schema
-- Target: Supabase (PostgreSQL 15+). Assumes Supabase's `auth` schema,
-- `auth.uid()` and the `anon` / `authenticated` / `service_role` roles.
-- =====================================================================

-- gen_random_uuid() is built into PostgreSQL 13+ (no extension needed).

-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------
create type review_status as enum ('approved', 'pending_review', 'needs_rereview', 'rejected');
create type recipe_status as enum ('verified', 'review_required', 'demo', 'unavailable');
create type dietary_pattern as enum ('vegetarian', 'vegetarian_eggs', 'non_vegetarian', 'other');
create type product_category as enum ('nutrition_powder', 'gummies', 'snack', 'oral_care', 'spread', 'other');
create type concern_type as enum ('picky_eating','protein_foods','fruit_veg','calcium','iron','vitamin_d','other_nutrient','appetite','feeding_symptom','meal_prep','product_question','other');

-- ---------------------------------------------------------------------
-- Admin roles
-- ---------------------------------------------------------------------
create table admin_users (
  user_id uuid primary key,
  role text not null default 'content_admin' check (role in ('content_admin', 'owner')),
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admin_users where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Knowledge base
-- ---------------------------------------------------------------------
create table evidence_sources (
  id text primary key,
  title text not null,
  url text not null check (url ~ '^https?://'),
  publisher text not null,
  source_type text not null,
  retrieved_at date not null,
  published_at date,
  reviewed_at date,
  review_status review_status not null default 'pending_review',
  claims_supported jsonb not null default '[]'::jsonb,
  notes text not null default ''
);

create table products (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  brand text not null,
  product_family text not null,
  variant_name text not null,
  category product_category not null,
  flavour text,
  pack_size text,
  age_min_months int check (age_min_months is null or age_min_months >= 0),
  age_max_months int check (age_max_months is null or age_max_months >= 0),
  age_guidance_text text,
  ingredients jsonb not null,      -- { items: [{name, allergens[], share?}], completeness, note }
  nutrient_data jsonb not null,    -- { items: [{nutrient, amount, unit, per, note?}], completeness, manufacturer_stated, note }
  allergen_data jsonb not null,    -- { contains[], preparation_adds[], statement, basis, cross_contact_info }
  official_instructions jsonb not null, -- { text, verified, source_quote, note }
  warnings jsonb not null default '[]'::jsonb,
  description text not null,
  official_url text not null check (official_url ~ '^https://'),
  image_url text,
  source_type text not null,
  last_fetched_at timestamptz,
  last_reviewed_at timestamptz,
  reviewed_by text,
  review_status review_status not null default 'pending_review',
  recommendation_eligible boolean not null default false,
  active boolean not null default true,
  field_status jsonb not null,
  conflicts jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  source_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint age_range_valid check (age_min_months is null or age_max_months is null or age_min_months <= age_max_months),
  -- Only approved records may be recommendation-eligible.
  constraint eligible_requires_approval check (not recommendation_eligible or review_status = 'approved')
);
create index products_family_idx on products (product_family);
create index products_category_idx on products (category);
create index products_status_idx on products (review_status);

create table product_evidence (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references products(id) on delete cascade,
  evidence_source_id text not null references evidence_sources(id) on delete restrict,
  field_supported text not null,
  claim_supported text,
  review_status review_status not null default 'pending_review',
  unique (product_id, evidence_source_id, field_supported)
);

create table nutrient_references (
  id text primary key,
  nutrient_name text not null,
  age_group text not null,
  unit text not null,
  reference_value numeric not null check (reference_value >= 0),
  reference_type text not null,
  source_id text not null references evidence_sources(id),
  review_status review_status not null default 'pending_review',
  notes text not null default ''
);
comment on table nutrient_references is 'Intentionally empty until a validated reference dataset is imported and professionally reviewed.';

create table recipes (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null,
  description text not null,
  age_min_months int,
  age_max_months int,
  meal_types text[] not null,
  ingredients jsonb not null,
  preparation_steps jsonb not null,
  prep_time_minutes int not null check (prep_time_minutes >= 0),
  cook_time_minutes int not null check (cook_time_minutes >= 0),
  difficulty text not null check (difficulty in ('easy','moderate','involved')),
  allergens text[] not null default '{}',
  dietary_tags text[] not null default '{}',
  food_groups text[] not null default '{}',
  textures text[] not null default '{}',
  concern_tags concern_type[] not null default '{}',
  nutritional_information jsonb,
  benefit_description text not null,
  substitutions jsonb not null default '[]'::jsonb,
  caveats jsonb not null default '[]'::jsonb,
  source_status text not null check (source_status in ('documented_source','adapted_from_source','original_demo_concept')),
  source_ids text[] not null default '{}',
  source_notes text not null default '',
  review_status recipe_status not null default 'review_required',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index recipes_status_idx on recipes (review_status);
create index recipes_concern_idx on recipes using gin (concern_tags);

create table recipe_products (
  id text primary key,
  recipe_id text not null references recipes(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  use_description text not null,
  validated_quantity text,
  quantity_unit text,
  usage_constraints jsonb not null default '[]'::jsonb,
  evidence_source_id text references evidence_sources(id),
  review_status review_status not null default 'pending_review',
  conflict_notes text not null default '',
  unique (recipe_id, product_id)
);

-- Catalogue of parent-selectable concerns (the per-profile table is parent_concerns).
create table concern_catalog (
  id concern_type primary key,
  name text not null,
  description text not null,
  type text not null check (type in ('practical','dietary','symptom_related','nutrient_related')),
  risk_level text not null check (risk_level in ('low','medium','high')),
  professional_review_required boolean not null default false,
  education_topics text[] not null default '{}'
);

create table concern_education (
  id text primary key,
  concern_type text not null,
  title text not null,
  educational_content jsonb not null,
  food_guidance jsonb not null default '[]'::jsonb,
  missing_information_questions jsonb not null default '[]'::jsonb,
  recommended_next_steps jsonb not null default '[]'::jsonb,
  referral_conditions jsonb not null default '[]'::jsonb,
  evidence_source_ids text[] not null default '{}',
  review_status review_status not null default 'pending_review'
);
create index concern_education_type_idx on concern_education (concern_type);

create table concern_product_rules (
  id text primary key,
  concern_type concern_type not null,
  product_id text not null references products(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('informational_contains_nutrient','informational_food_format','professionally_governed')),
  intended_purpose text not null,
  eligibility_conditions jsonb not null,
  exclusion_conditions jsonb not null,
  parent_facing_explanation text not null,
  evidence_source_id text references evidence_sources(id),
  review_status review_status not null default 'pending_review'
);

create table recommendation_rules (
  id text primary key,
  name text not null,
  description text not null,
  conditions jsonb not null,
  effects jsonb not null,
  output_type text not null check (output_type in ('referral','restriction','warning','education')),
  required_review_status review_status not null default 'approved',
  review_status review_status not null default 'pending_review'
);

-- ---------------------------------------------------------------------
-- Parent data (sensitive — owner-only via RLS)
-- owner_id = auth.uid() for Supabase-authenticated (incl. anonymous) users.
-- ---------------------------------------------------------------------
create table child_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,              -- brief's user_id; nullable demo profiles are never persisted
  nickname text check (char_length(nickname) <= 30),
  age_years int not null check (age_years between 0 and 18),
  age_months int not null default 0 check (age_months between 0 and 11),
  gender text check (gender in ('girl','boy','another','prefer_not')),
  dietary_pattern dietary_pattern not null,
  dietary_other text,
  food_preferences jsonb not null default '{}'::jsonb, -- { likes[], textures_accepted[], available_ingredients[] }
  food_aversions jsonb not null default '{}'::jsonb,   -- { refuses[], textures_refused[], eating_difficulties }
  meal_routine jsonb not null default '{}'::jsonb,     -- { breakfast, lunch, dinner, snacks, beverages, eats_outside, prep_time, cooking_complexity }
  assistance jsonb not null default '{}'::jsonb,       -- { assistance[], assistance_other, no_known_allergies }
  consent jsonb not null default '{"persist": true, "ai_explanations": false}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint max_age check (age_years * 12 + age_months <= 216)
);
create index child_profiles_owner_idx on child_profiles (owner_id);

create table profile_allergies (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references child_profiles(id) on delete cascade,
  ingredient_or_allergen text not null,
  label text,
  kind text not null default 'allergy' check (kind in ('allergy','intolerance')),
  reaction_details text,
  severity text check (severity in ('mild','moderate','severe','unknown')),
  source text not null default 'parent_reported'
);
create index profile_allergies_profile_idx on profile_allergies (profile_id);

create table parent_concerns (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references child_profiles(id) on delete cascade,
  concern_type concern_type not null,
  parent_description text,
  reported_status text not null default 'not_sure' check (reported_status in ('general_concern','suspected','professional_identified','not_sure')),
  professional_assessment_status text check (professional_assessment_status in ('yes','no','not_sure')),
  professional_instructions_text text,
  created_at timestamptz not null default now()
);
create index parent_concerns_profile_idx on parent_concerns (profile_id);

create table profile_products (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references child_profiles(id) on delete cascade,
  catalog_product_id text references products(id) on delete set null,
  is_external_unverified boolean not null default false,
  brand text not null,
  product_name text not null,
  variant text,
  age_variant text,
  frequency text,
  parent_reported_routine text,       -- never treated as the official instruction
  follows_pack_instructions text not null default 'not_sure',
  difficulties text,
  wants_help text[] not null default '{}'
);
create index profile_products_profile_idx on profile_products (profile_id);

create table saved_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  item_type text not null check (item_type in ('recipe','product')),
  item_id text not null,
  note text,
  created_at timestamptz not null default now(),
  unique (owner_id, item_type, item_id)
);

create table recommendation_feedback (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references child_profiles(id) on delete set null,
  recommendation_type text not null,
  recommendation_id text,
  rating text check (rating in ('helpful','not_helpful')),
  feedback_text text check (char_length(feedback_text) <= 1000),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Ingestion & audit
-- ---------------------------------------------------------------------
create table product_imports (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  canonical_url text,
  matched_product_id text references products(id) on delete set null,
  fetched_at timestamptz not null default now(),
  status text not null check (status in ('new','unchanged','changed','failed','approved','rejected')),
  extracted jsonb not null default '{}'::jsonb,
  diff jsonb not null default '[]'::jsonb,
  missing_fields jsonb not null default '[]'::jsonb,
  error text
);
create index product_imports_status_idx on product_imports (status);

create table content_change_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  field text,
  previous_value jsonb,
  new_value jsonb,
  source_id text,
  changed_at timestamptz not null default now(),
  changed_by text not null,
  review_status review_status not null default 'pending_review',
  critical boolean not null default false
);
create index change_log_entity_idx on content_change_log (entity_type, entity_id);

-- updated_at triggers
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger products_touch before update on products for each row execute function touch_updated_at();
create trigger recipes_touch before update on recipes for each row execute function touch_updated_at();
create trigger child_profiles_touch before update on child_profiles for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table admin_users enable row level security;
alter table evidence_sources enable row level security;
alter table products enable row level security;
alter table product_evidence enable row level security;
alter table nutrient_references enable row level security;
alter table recipes enable row level security;
alter table recipe_products enable row level security;
alter table concern_catalog enable row level security;
alter table concern_education enable row level security;
alter table concern_product_rules enable row level security;
alter table recommendation_rules enable row level security;
alter table child_profiles enable row level security;
alter table profile_allergies enable row level security;
alter table parent_concerns enable row level security;
alter table profile_products enable row level security;
alter table saved_items enable row level security;
alter table recommendation_feedback enable row level security;
alter table product_imports enable row level security;
alter table content_change_log enable row level security;

-- Knowledge base: anyone may read published (non-rejected) content; only admins write.
create policy kb_read_sources on evidence_sources for select to anon, authenticated using (review_status <> 'rejected');
create policy kb_read_products on products for select to anon, authenticated using (active and review_status <> 'rejected');
create policy kb_read_product_evidence on product_evidence for select to anon, authenticated using (true);
create policy kb_read_recipes on recipes for select to anon, authenticated using (active and review_status <> 'unavailable');
create policy kb_read_recipe_products on recipe_products for select to anon, authenticated using (review_status <> 'rejected');
create policy kb_read_catalog on concern_catalog for select to anon, authenticated using (true);
create policy kb_read_education on concern_education for select to anon, authenticated using (review_status = 'approved');
create policy kb_read_nutrient_refs on nutrient_references for select to anon, authenticated using (review_status = 'approved');

create policy kb_admin_sources on evidence_sources for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_products on products for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_product_evidence on product_evidence for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_recipes on recipes for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_recipe_products on recipe_products for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_education on concern_education for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_cpr on concern_product_rules for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_rules on recommendation_rules for all to authenticated using (is_admin()) with check (is_admin());
create policy kb_admin_nutrient_refs on nutrient_references for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_imports on product_imports for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_change_log on content_change_log for all to authenticated using (is_admin()) with check (is_admin());
create policy admin_feedback_read on recommendation_feedback for select to authenticated using (is_admin());
create policy admin_self on admin_users for select to authenticated using (user_id = auth.uid());
-- concern_product_rules and recommendation_rules: no public read (internal routing logic).

-- Parent data: owner-only. No access for anon.
create policy profiles_owner on child_profiles for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy allergies_owner on profile_allergies for all to authenticated
  using (exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()));
create policy concerns_owner on parent_concerns for all to authenticated
  using (exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()));
create policy products_owner on profile_products for all to authenticated
  using (exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()));
create policy saved_owner on saved_items for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Feedback: anyone may submit; it can only reference a profile they own.
create policy feedback_insert on recommendation_feedback for insert to anon, authenticated
  with check (profile_id is null or exists (select 1 from child_profiles p where p.id = profile_id and p.owner_id = auth.uid()));

-- Explicit grants (Supabase grants table privileges to anon/authenticated by default; RLS restricts rows).
grant usage on schema public to anon, authenticated;
grant select on evidence_sources, products, product_evidence, recipes, recipe_products, concern_catalog, concern_education, nutrient_references to anon, authenticated;
grant select, insert, update, delete on child_profiles, profile_allergies, parent_concerns, profile_products, saved_items to authenticated;
grant insert on recommendation_feedback to anon, authenticated;
grant select, insert, update, delete on evidence_sources, products, product_evidence, recipes, recipe_products, concern_education, concern_product_rules, recommendation_rules, nutrient_references, product_imports, content_change_log to authenticated;
grant select on recommendation_feedback, admin_users to authenticated;
