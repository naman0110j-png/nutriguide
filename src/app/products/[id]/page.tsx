import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepository } from "@/lib/repo";
import { missingFields } from "@/lib/engine/products";
import { ALLERGEN_LABELS } from "@/lib/kb";
import { formatAgeRange } from "@/lib/engine/checks";
import { SaveProductButton } from "@/components/SaveProductButton";

export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = { verified: "Verified", unverified: "Partly verified", conflict: "Conflicting on source", missing: "Not verified" };
const FIELD_TONE: Record<string, string> = { verified: "border-mist-300 bg-mist-50 text-mist-700", unverified: "border-clay-200 bg-white text-clay-700", conflict: "border-clay-300 bg-clay-50 text-clay-700", missing: "border-ivory-300 bg-ivory-200 text-ink-soft" };

function Field({ status }: { status: string | undefined }) {
  const st = status ?? "missing";
  return <span className={`chip ${FIELD_TONE[st]}`}>{FIELD_LABEL[st] ?? st}</span>;
}

export async function generateMetadata({ params }: { params: { id: string } }) {
  const kb = await getRepository().getKnowledgeBase();
  const p = kb.products.find((x) => x.id === params.id);
  return { title: p?.variant_name ?? "Product" };
}

export default async function ProductPage({ params }: { params: { id: string } }) {
  const kb = await getRepository().getKnowledgeBase();
  const p = kb.products.find((x) => x.id === params.id && x.active);
  if (!p) notFound();
  const sources = p.source_ids.map((id) => kb.sources.find((s) => s.id === id)).filter(Boolean);
  const linked = kb.recipeProducts.filter((r) => r.product_id === p.id);
  const missing = missingFields(p);
  const fs = p.field_status;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <nav className="text-sm"><Link href="/products">← All products</Link></nav>
      <header className="card card-pad">
        <p className="eyebrow">{p.brand} · {p.product_family}</p>
        <h1 className="mt-2 text-3xl">{p.variant_name}</h1>
        <p className="mt-2 text-sm text-ink-soft">{p.description}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <a href={p.official_url} target="_blank" rel="noopener noreferrer" className="btn-secondary">Official product page ↗</a>
          <SaveProductButton id={p.id} />
        </div>
        <p className="mt-4 text-xs text-ink-faint">
          Last fetched: {p.last_fetched_at?.slice(0, 10) ?? "never"} · Last reviewed: {p.last_reviewed_at?.slice(0, 10) ?? "not reviewed"}{p.reviewed_by ? ` — ${p.reviewed_by}` : ""}
        </p>
        {p.review_status === "needs_rereview" && <p className="mt-3 rounded-xl bg-clay-50 px-3 py-2 text-sm text-clay-700">The official page changed since this record was reviewed. The previously reviewed values are shown until the change is checked; this product is not used in recommendations meanwhile.</p>}
      </header>

      {p.category === "oral_care" && (
        <div className="rounded-xl border border-mist-300/70 bg-mist-50 px-4 py-3 text-sm text-mist-700">Oral-care product: shown for information only and kept separate from nutrition guidance. Ask your child&rsquo;s dentist about toothpaste type and amount.</div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card card-pad">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl">Age guidance</h2><Field status={fs.age_guidance} /></div>
          <p className="mt-2 text-sm">{p.age_guidance_text ?? "Not stated on the retrieved page."}</p>
          {fs.age_guidance === "verified" && <p className="mt-1 text-xs text-ink-faint">Stored as {formatAgeRange(p.age_min_months, p.age_max_months)}.</p>}
        </section>
        <section className="card card-pad">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl">Official instructions</h2><Field status={fs.instructions} /></div>
          {p.official_instructions.verified && p.official_instructions.text ? (
            <>
              <blockquote className="mt-2 border-l-2 border-mist-300 pl-3 text-sm">{p.official_instructions.source_quote ?? p.official_instructions.text}</blockquote>
              <p className="mt-1 text-xs text-ink-faint">Quoted from the official page. We explain it but never change the quantity.</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-soft">Not verified. Please follow the instructions on your pack.</p>
          )}
          {p.official_instructions.note && <p className="mt-2 text-xs text-ink-soft">{p.official_instructions.note}</p>}
        </section>
      </div>

      <section className="card card-pad">
        <div className="flex items-center justify-between gap-2"><h2 className="text-xl">Ingredients</h2><Field status={fs.ingredients} /></div>
        {p.ingredients.items.length ? (
          <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
            {p.ingredients.items.map((i) => (
              <li key={i.name} className="flex flex-wrap items-baseline gap-2">
                {i.name}{i.share ? <span className="text-xs text-ink-faint">{i.share}</span> : null}
                {i.allergens.map((a) => <span key={a} className="chip border-clay-200 bg-clay-50 text-clay-700">{ALLERGEN_LABELS[a]}</span>)}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-ink-soft">Not verified.</p>}
        <p className="mt-3 text-xs text-ink-faint">{p.ingredients.note}</p>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card card-pad">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl">Allergens</h2><Field status={fs.allergens} /></div>
          <p className="mt-2 text-sm">{p.allergen_data.contains.length ? `Contains: ${p.allergen_data.contains.map((a) => ALLERGEN_LABELS[a]).join(", ")}` : "No allergen information verified."}</p>
          {p.allergen_data.preparation_adds.length > 0 && <p className="mt-1 text-sm">Preparation adds: {p.allergen_data.preparation_adds.map((a) => ALLERGEN_LABELS[a]).join(", ")} (e.g. mixing with milk)</p>}
          {p.allergen_data.statement && <blockquote className="mt-2 border-l-2 border-clay-300 pl-3 text-sm">{p.allergen_data.statement}</blockquote>}
          <p className="mt-2 text-xs text-ink-faint">Basis: {p.allergen_data.basis.replace(/_/g, " ")}. Cross-contact: {p.allergen_data.cross_contact_info ?? "no information available"}. Absence from this list does not mean an ingredient is absent — always check the pack.</p>
        </section>
        <section className="card card-pad">
          <div className="flex items-center justify-between gap-2"><h2 className="text-xl">Nutrients</h2><span className="chip border-ivory-300 bg-ivory-200 text-ink-soft">Manufacturer-stated</span></div>
          {p.nutrient_data.items.length ? (
            <ul className="mt-2 space-y-1 text-sm">{p.nutrient_data.items.map((n) => <li key={n.nutrient}><strong>{n.nutrient}:</strong> {n.amount} {n.unit} <span className="text-ink-faint">per {n.per}</span>{n.note ? <span className="block text-xs text-ink-faint">{n.note}</span> : null}</li>)}</ul>
          ) : <p className="mt-2 text-sm text-ink-soft">Not verified.</p>}
          <p className="mt-2 text-xs text-ink-faint">{p.nutrient_data.note} These are the manufacturer&rsquo;s figures, not independent analysis.</p>
        </section>
      </div>

      {(p.warnings.length > 0 || p.conflicts.length > 0 || missing.length > 0) && (
        <section className="card card-pad space-y-3">
          <h2 className="text-xl">Caveats</h2>
          {p.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {p.conflicts.length > 0 && <ul className="space-y-1 text-sm text-clay-700">{p.conflicts.map((c) => <li key={c}>Source conflict: {c}</li>)}</ul>}
          {missing.length > 0 && <p className="text-sm text-ink-soft">Not verified in this record: {missing.join(", ")}.</p>}
          {p.notes.length > 0 && <ul className="space-y-1 text-xs text-ink-faint">{p.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        </section>
      )}

      {linked.length > 0 && (
        <section className="card card-pad">
          <h2 className="text-xl">Ways to use it in our dataset</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {linked.map((r) => (
              <li key={r.id}>
                <strong>{kb.recipes.find((x) => x.id === r.recipe_id)?.name}</strong> — {r.use_description}
                <span className="ml-2 chip border-clay-200 bg-clay-50 text-clay-700">{r.review_status === "approved" ? "Reviewed" : "Not yet reviewed"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card card-pad">
        <h2 className="text-xl">Sources</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {sources.map((s) => (
            <li key={s!.id}>
              <a href={s!.url} target="_blank" rel="noopener noreferrer">{s!.title}</a>
              <span className="block text-xs text-ink-faint">{s!.publisher} · retrieved {s!.retrieved_at}{s!.notes ? ` · ${s!.notes}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
