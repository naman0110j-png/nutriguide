/**
 * Applies the real migration + generated seed to an embedded PostgreSQL (PGlite),
 * with a small shim for Supabase's auth schema and roles, then checks constraints
 * and Row Level Security. Usage: npm run db:test-migrations
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { buildSeedSql } from "./generate-seed-sql";

const SUPABASE_SHIM = `
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema auth to anon, authenticated;
`;

export async function runMigrationChecks(log = console.log) {
  const db = new PGlite();
  const results: { name: string; ok: boolean; detail?: string }[] = [];
  const check = (name: string, ok: boolean, detail?: string) => { results.push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

  await db.exec(SUPABASE_SHIM);
  const migDir = path.join(__dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(migDir).sort()) await db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  check("migrations apply cleanly", true);
  await db.exec(buildSeedSql());
  const counts = await db.query<{ t: string; n: number }>(`
    select 'products' t, count(*)::int n from products union all
    select 'recipes', count(*)::int from recipes union all
    select 'evidence_sources', count(*)::int from evidence_sources union all
    select 'concern_education', count(*)::int from concern_education union all
    select 'nutrient_references', count(*)::int from nutrient_references`);
  const c = Object.fromEntries(counts.rows.map((r) => [r.t, r.n]));
  check("seed loads", c.products > 0 && c.recipes >= 6, JSON.stringify(c));
  check("nutrient_references left empty", c.nutrient_references === 0);

  // Constraint: an unapproved product cannot be recommendation-eligible.
  try {
    await db.exec(`update products set recommendation_eligible = true where id = 'lj-calcium-gummies-strawberry-4-6-30n'`);
    check("eligible_requires_approval constraint", false, "update succeeded unexpectedly");
  } catch {
    check("eligible_requires_approval constraint", true);
  }

  // Two owners, one profile each.
  const A = "11111111-1111-1111-1111-111111111111";
  const B = "22222222-2222-2222-2222-222222222222";
  await db.exec(`
    insert into child_profiles (id, owner_id, age_years, age_months, dietary_pattern) values
      ('aaaaaaaa-0000-0000-0000-000000000001', '${A}', 5, 0, 'vegetarian'),
      ('bbbbbbbb-0000-0000-0000-000000000002', '${B}', 3, 6, 'non_vegetarian');
    insert into profile_allergies (profile_id, ingredient_or_allergen) values ('bbbbbbbb-0000-0000-0000-000000000002', 'milk');
  `);

  const asUser = async (uid: string | null, sql: string) => {
    await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
    try { return await db.query<Record<string, unknown>>(sql); } finally { await db.exec("reset role;"); }
  };

  const aSees = await asUser(A, "select id from child_profiles");
  check("owner A sees only own profile", aSees.rows.length === 1 && aSees.rows[0].id === "aaaaaaaa-0000-0000-0000-000000000001");
  const aAllergies = await asUser(A, "select * from profile_allergies");
  check("owner A cannot read owner B's allergies", aAllergies.rows.length === 0);
  const anonProfiles = await asUser(null, "select * from child_profiles").catch((e) => ({ rows: [], err: String(e) }));
  check("anonymous cannot read profiles", anonProfiles.rows.length === 0);
  const anonProducts = await asUser(null, "select id from products");
  check("anonymous can read published products", anonProducts.rows.length > 0);
  let anonWriteBlocked = false;
  try { await asUser(null, "update products set brand = 'x'"); const chk = await db.query<{ n: number }>("select count(*)::int n from products where brand = 'x'"); anonWriteBlocked = chk.rows[0].n === 0; } catch { anonWriteBlocked = true; }
  check("anonymous cannot modify products", anonWriteBlocked);
  let nonAdminWriteBlocked = false;
  try { await asUser(A, "update products set brand = 'y'"); const chk = await db.query<{ n: number }>("select count(*)::int n from products where brand = 'y'"); nonAdminWriteBlocked = chk.rows[0].n === 0; } catch { nonAdminWriteBlocked = true; }
  check("non-admin user cannot modify products", nonAdminWriteBlocked);
  await db.exec(`insert into admin_users (user_id) values ('${A}')`);
  await asUser(A, "update products set reviewed_by = 'admin test' where id = 'lj-millet-choco-fills-250g'");
  const adminWrote = await db.query<{ n: number }>("select count(*)::int n from products where reviewed_by = 'admin test'");
  check("admin user can modify products", adminWrote.rows[0].n === 1);
  const bInsertForA = await asUser(B, `insert into profile_allergies (profile_id, ingredient_or_allergen) values ('aaaaaaaa-0000-0000-0000-000000000001', 'egg')`).then(() => false).catch(() => true);
  check("owner B cannot write into owner A's profile", bInsertForA);
  const rulesHidden = await asUser(null, "select * from recommendation_rules").then((r) => r.rows.length === 0).catch(() => true);
  check("routing rules not publicly readable", rulesHidden);

  await db.exec(`delete from child_profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002'`);
  const orphan = await db.query<{ n: number }>("select count(*)::int n from profile_allergies");
  check("profile deletion cascades to allergies", orphan.rows[0].n === 0);

  await db.close();
  return results;
}

if (process.argv[1] && process.argv[1].endsWith("test-migrations.ts")) {
  runMigrationChecks().then((r) => {
    const failed = r.filter((x) => !x.ok);
    console.log(`\n${r.length - failed.length}/${r.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(1); });
}
