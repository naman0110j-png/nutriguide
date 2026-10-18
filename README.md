# Little Joys NutriGuide (working name)
   **Live demo:** https://nutriguide-roan.vercel.app
A parent-facing, educational child-nutrition and product-use assistant. Parents build a short profile; the app produces a plain-language overview, practical food ideas that pass deterministic age / diet / allergy checks, the **verbatim official instructions** for products they already use, and clear statements of what it *cannot* determine.

> **Independent prototype.** Inspired by the Little Joys range (Mosaic Wellness). **Not affiliated with or endorsed by Mosaic Wellness or Little Joys.** It does not diagnose, treat or prescribe. Nothing in the dataset has been reviewed by a nutrition professional.

---

## What's in the box

| Area | Where |
|---|---|
| Parent UI (landing, 6-step onboarding, overview, workspace + assistant, catalogue, product detail, saved, privacy) | `src/app`, `src/components` |
| Domain schemas (Zod — shared by UI, API, engine, AI validator) | `src/lib/schemas.ts` |
| Deterministic engine: age / allergen / diet checks, safety-rule DSL, overview, recipe retrieval, product eligibility | `src/lib/engine/*` |
| AI layer: provider adapter (Anthropic / OpenAI-compatible), evidence bundle, safety linter, schema validation, retry → fallback, guarded chat | `src/lib/ai/*` |
| Ingestion: robots.txt parser, sitemap discovery, extractor, change detection, staging | `src/lib/ingest/*` |
| Repositories: demo JSON store + Supabase (service role, owner-scoped) | `src/lib/repo/*` |
| SQL schema, constraints, indexes, RLS | `supabase/migrations/` |
| Seed data (single source of truth in TS → generated SQL) | `src/data/seed/*`, `supabase/seed.sql` |
| Tests | `tests/*.test.ts`, `scripts/test-migrations.ts`, `scripts/e2e-api.mjs`, `scripts/e2e.mjs` |

Stack: Next.js 14 (App Router) · TypeScript · Tailwind · Zod · Supabase/PostgreSQL · Vitest · Playwright.

## Quick start (demo mode — no credentials needed)

```bash
npm install
cp .env.example .env.local        # defaults run in demo mode
npm run dev                        # http://localhost:3000
```

Demo mode uses the seeded knowledge base, a local JSON store at `.data/demo-store.json` for saved profiles/admin edits, and deterministic template explanations. A banner makes this visible on every page. Three synthetic demo profiles are on the landing page.

To use the admin console locally, set `ADMIN_PASSWORD` (8+ chars) and `SESSION_SECRET` (16+ chars) in `.env.local`. Admin is **disabled** if either is missing.

## Configuration

See `.env.example`. Summary:

| Variable | Purpose |
|---|---|
| `DATA_BACKEND` | `demo` (default) or `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase (service key is server-only) |
| `CONTENT_MODE` | `demo` shows labelled unreviewed recipe concepts; `production` shows **only** `verified` recipes and approved product–recipe links |
| `LLM_PROVIDER` / `LLM_API_KEY` / `LLM_MODEL` / `LLM_BASE_URL` / `LLM_TIMEOUT_MS` | `none`, `anthropic`, or `openai` (any OpenAI-compatible endpoint) |
| `ADMIN_PASSWORD`, `SESSION_SECRET` | Admin console and cookie signing |
| `INGEST_*` | Importer user agent, minimum delay, host allowlist |

No secret is prefixed `NEXT_PUBLIC_`. A build scan confirmed no secret values or provider endpoints appear in client bundles.

## Database (Supabase)

```bash
supabase db push                         # applies supabase/migrations/*
npm run db:seed-sql && psql "$DB_URL" -f supabase/seed.sql
npm run db:test-migrations               # applies migration + seed to embedded Postgres (PGlite) and checks RLS
```

Key design points:
- Knowledge tables (`products`, `recipes`, `recipe_products`, `evidence_sources`, `product_evidence`, `concern_catalog`, `concern_education`, `concern_product_rules`, `recommendation_rules`, `nutrient_references`) use structured `jsonb` for ingredients/nutrients/allergens/instructions to support exact-variant matching.
- Constraint `eligible_requires_approval`: a product cannot be `recommendation_eligible` unless `review_status = 'approved'`.
- Parent data (`child_profiles`, `profile_allergies`, `parent_concerns`, `profile_products`, `saved_items`) is owner-only via RLS (`owner_id = auth.uid()`); anonymous users have no access. Routing rules are not publicly readable. Writes to the knowledge base require `is_admin()`.
- `nutrient_references` is **intentionally empty** (see Limitations).
- Naming note: the brief's catalogue-level `parent_concerns` is `concern_catalog` here; `parent_concerns` holds per-profile concerns.

## How a recommendation is produced

1. Profile + concern are validated (Zod).
2. **Approved** safety rules run (`rule-under-two`, `rule-suspected-deficiency`, `rule-severe-allergy`, `rule-any-allergy`, `rule-feeding-symptom`) and may block products / unreviewed recipes and add referral text.
3. Each recipe is checked: status allowed for content mode → age → dietary pattern → allergens (incl. product sub-ingredients; incomplete data + any allergy ⇒ excluded) → meal/time filters → product link (exact owned variant, verified instruction, product age-eligible, link not rejected; must be approved in production).
4. Ranking is transparent and non-commercial (concern tag, likes, available ingredients, texture, time window, review status). Only recipes tagged for the selected concern are "recommended" (max 3) — nothing is padded to reach three.
5. Optional product information appears only via an **approved** concern–product rule, when the parent asked to learn about products, and after age, data-completeness, instruction-verification and allergen checks pass. No product passes for picky eating, and none is shown for a suspected deficiency.
6. If AI is configured **and** the parent consented, a de-identified evidence bundle (no nickname, no free text) is sent; the model returns JSON that is schema-validated, ID-checked and safety-linted (diagnosis, treatment claims, outcome promises, prescribing, serving changes, meal replacement, nutrient labels, safety guarantees, any quantity not in the facts). One retry with feedback, then deterministic fallback. The model only supplies explanation text — never which items are shown.

### Structured output
`POST /api/recommendations` returns: `profile_summary`, `known_information`, `reported_concerns`, `areas_to_explore`, `information_gaps`, `general_education`, `recipe_recommendations` (recipe, evidence label, relevance, age/allergen checks, product use, sources, explanation), `more_recipes`, `excluded` (with reasons), `owned_products` (exact match, official vs parent routine), `product_information`, `professional_guidance`, `warnings`, `applied_rules`, `evidence_sources`, `disclaimers`, `generated_by`.

### Assistant
Safety guards run first and cannot be rephrased by the LLM: emergency (→ call 112), diagnosis requests, and dosing/combining questions (shows the verified instruction verbatim and refers to a paediatrician/pharmacist). Data intents ("without eggs", "another breakfast idea") re-run the same engine. Other intents: why-suggested, missing info, explain instructions, ingredient glossary.

## Ingestion

Admin → *Imports & refresh*: refresh one product, a category, everything, a single official URL, or discover product URLs from the official sitemap. The importer only fetches allow-listed hosts over https, honours `robots.txt` (and **fails closed** if it can't be read), waits `INGEST_MIN_DELAY_MS` between requests, dedupes by canonical URL, and writes to a **staging** record. If age, instructions or ingredients differ from the approved record, the product becomes `needs_rereview` and leaves recommendations; approved values are kept and every change is logged. Admins mark an import reviewed (then edit and approve the product) or reject it (restores the previous status). The app never depends on ingestion at runtime.

## Tests

```bash
npm test                         # 97 unit/integration tests (engine, AI, chat, ingestion, repos, seed integrity, migrations+RLS on PGlite)
npm run build && npm start       # then, against the running server:
BASE=http://localhost:3000 ADMIN_PASSWORD=... node scripts/e2e-api.mjs    # 42 API checks
BASE=http://localhost:3000 ADMIN_PASSWORD=... CHROMIUM=/path/to/chrome-headless-shell node scripts/e2e.mjs   # 45 browser checks, desktop + mobile
```

## Deployment

Vercel works out of the box (`next build`). For anything beyond a demo, use `DATA_BACKEND=supabase`: on Vercel the demo store falls back to `/tmp`, which is ephemeral and per-instance. Set `INSECURE_COOKIES` only for local http testing.

## Data provenance & status

- **Products (8 records)** — from official `ourlittlejoys.com` pages, retrieved 2026-10-18. Fields not visible in the retrieved page text are left null and flagged; conflicts found on the official pages are recorded (e.g. toothpaste "Fluoride free" vs "With Fluoride"; gummies age 4–6 vs 2–9 / 4–12; Choco Fills 2+ vs 4+; blog smoothie uses 1 scoop vs product page 2 scoops). `reviewed_by` says plainly that this was an AI-assisted build-time check, not a professional or manufacturer review. Product images are not used (licensing not confirmed).
- **Recipes (12)** — none `verified`. 6 `review_required` (from the Little Joys blog, with discrepancies noted); 6 `demo` (original concepts). No nutrient analysis; no "high-protein"/"iron-rich" style claims.
- **Education (17 records)** — sourced from AAP HealthyChildren, WHO (2023 complementary feeding), NIH ODS fact sheets, ICMR-NIN DGI 2024, Nemours KidsHealth, Hackensack Meridian Health. Several are US-focused; Indian-specific review is a next step.

## Limitations & incomplete items (honest list)

- **No professional review** of any recipe, education text or product record. `CONTENT_MODE=production` will therefore show no recipes until a dietitian marks some `verified`.
- **Nutrient references / adequacy calculations: not implemented by design.** The table and admin notice exist; populate only from a validated dataset (e.g. ICMR-NIN 2020 RDA/EAR) after professional review.
- **Live AI not tested** against a real provider (no API key in this build). The adapter and the full validate/retry/fallback pipeline are tested with mocked responses.
- **Supabase repository not run against a live project** (no credentials). The SQL, seed and RLS policies are tested on embedded PostgreSQL; the TypeScript client code is type-checked only.
- **Live ingestion not demonstrated**: the build sandbox could not reach ourlittlejoys.com, and the importer correctly failed closed. Extraction, diffing, dedupe, robots handling and failure safety are tested on fixtures modelled on the real pages. Extraction is heuristic; expect to tune selectors.
- Parent auth is anonymous (signed httpOnly cookie owner ID). Supabase Auth sign-in (incl. anonymous sign-ins) would let RLS apply to direct client access; admin uses a shared password, not per-user roles (the `admin_users` table and `is_admin()` are ready).
- Demo store is single-process JSON, not encrypted at rest — demo only.
- Some product variants (e.g. Nutrimix Strawberry, Vanilla, 13–18) are placeholders or absent and need import + review.

## Continuing development

1. Have a registered dietitian review recipes, education and the age guidance per product; flip statuses in the admin console.
2. Connect Supabase, run migrations/seed, set `DATA_BACKEND=supabase`; add Supabase Auth for parents and admins.
3. Configure an LLM provider; run the AI tests against it and review rejected outputs in logs (counts only are logged).
4. Run ingestion from a network that can reach the official site; review staged diffs; import missing variants.
5. Consider an authorised product feed from the manufacturer instead of page extraction.
