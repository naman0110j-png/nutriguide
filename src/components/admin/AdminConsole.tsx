"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { KnowledgeBase } from "@/lib/kb";
import type { ChangeLogEntry, ProductImport } from "@/lib/schemas";
import { ENTITY_STATUSES, type EntityKind } from "@/lib/repo/types";
import { api, ApiError } from "@/lib/client/store";
import { Badge, Loading, Notice } from "@/components/ui";

interface AdminData {
  kb: KnowledgeBase;
  imports: ProductImport[];
  changeLog: ChangeLogEntry[];
  feedback: { id: string; recommendation_type: string; recommendation_id: string | null; rating: string | null; feedback_text: string | null; created_at: string }[];
  blocked: { id: string; variant_name: string; review_status: string; missing: string[]; conflicts: string[] }[];
  backend: string;
}

const TABS = ["Overview", "Products", "Imports & refresh", "Recipes", "Recipe–product links", "Education", "Rules", "Sources", "Change log", "Feedback"] as const;
type Tab = (typeof TABS)[number];

const KIND_FOR_TAB: Partial<Record<Tab, EntityKind>> = {
  Products: "products",
  Recipes: "recipes",
  "Recipe–product links": "recipeProducts",
  Education: "education",
  Sources: "sources",
};

const statusTone = (s: string) => (s === "approved" || s === "verified" ? "reviewed" : s === "rejected" || s === "unavailable" ? "caution" : s === "needs_rereview" ? "caution" : "incomplete");

export function AdminConsole({ configIssues, contentMode }: { configIssues: string[]; contentMode: string }) {
  const router = useRouter();
  const [data, setData] = useState<AdminData | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<AdminData>("/api/admin/kb"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load admin data.");
      if (e instanceof ApiError && e.status === 401) router.refresh();
    }
  }, [router]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setFlash(null);
    try {
      await fn();
      setFlash(ok);
      await load();
    } catch (e) {
      setFlash(e instanceof ApiError ? `${e.message}${e.issues ? ` — ${e.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}` : ""}` : "Action failed.");
    }
  };

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <Loading label="Loading knowledge base…" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Admin · content review</p>
          <h1 className="mt-1 text-3xl">Knowledge base</h1>
          <p className="text-xs text-ink-faint">Backend: {data.backend} · content mode: {contentMode}. Only approved records feed health-related product information.</p>
        </div>
        <button type="button" className="btn-ghost" onClick={async () => { await api("/api/admin/logout", { method: "POST" }); router.refresh(); }}>Sign out</button>
      </header>
      <nav aria-label="Admin sections" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)} className={`chip py-1.5 ${tab === t ? "border-ink bg-ink text-white" : "border-ivory-300 bg-white text-ink-soft"}`}>{t}</button>
        ))}
      </nav>
      {flash && <Notice tone={/fail|error|invalid|attention/i.test(flash) ? "error" : "info"}>{flash}</Notice>}

      {tab === "Overview" && <OverviewTab data={data} configIssues={configIssues} />}
      {KIND_FOR_TAB[tab] && <EntityTab kind={KIND_FOR_TAB[tab]!} records={data.kb[KIND_FOR_TAB[tab]!] as unknown as Record<string, unknown>[]} act={act} />}
      {tab === "Rules" && (
        <div className="space-y-8">
          <div><h2 className="mb-2 text-xl">Concern → product eligibility rules</h2><EntityTab kind="concernProductRules" records={data.kb.concernProductRules as unknown as Record<string, unknown>[]} act={act} /></div>
          <div><h2 className="mb-2 text-xl">Safety & routing rules</h2><EntityTab kind="recommendationRules" records={data.kb.recommendationRules as unknown as Record<string, unknown>[]} act={act} /></div>
        </div>
      )}
      {tab === "Imports & refresh" && <ImportsTab data={data} act={act} />}
      {tab === "Change log" && <ChangeLogTab entries={data.changeLog} />}
      {tab === "Feedback" && (
        <ul className="card divide-y divide-ivory-300 text-sm">
          {data.feedback.length === 0 && <li className="p-4 text-ink-faint">No feedback yet.</li>}
          {data.feedback.map((f) => <li key={f.id} className="p-4"><Badge tone={f.rating === "helpful" ? "reviewed" : "caution"}>{f.rating ?? "comment"}</Badge> <span className="text-ink-faint">{f.recommendation_type}{f.recommendation_id ? ` · ${f.recommendation_id}` : ""} · {f.created_at.slice(0, 16).replace("T", " ")}</span>{f.feedback_text && <p className="mt-1">{f.feedback_text}</p>}</li>)}
        </ul>
      )}
    </div>
  );
}

function OverviewTab({ data, configIssues }: { data: AdminData; configIssues: string[] }) {
  const k = data.kb;
  const stats = [
    ["Products", k.products.length, `${k.products.filter((p) => p.review_status === "approved").length} approved`],
    ["Recipes", k.recipes.length, `${k.recipes.filter((r) => r.review_status === "verified").length} verified`],
    ["Sources", k.sources.length, `${k.sources.filter((s) => s.review_status === "approved").length} approved`],
    ["Imports", data.imports.length, `${data.imports.filter((i) => i.status === "changed").length} with changes`],
  ] as const;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {stats.map(([l, n, s]) => <div key={l} className="card p-4"><p className="text-xs text-ink-faint">{l}</p><p className="font-display text-3xl">{n}</p><p className="text-xs text-ink-soft">{s}</p></div>)}
      </div>
      {configIssues.length > 0 && <Notice tone="caution" title="Configuration">{configIssues.map((c) => <p key={c}>{c}</p>)}</Notice>}
      <Notice tone="info" title="Nutrient reference values: none loaded">No validated, professionally reviewed reference dataset (e.g. ICMR-NIN 2020 RDA/EAR) has been imported, so the app performs no adequacy calculations. Import requires: source record, age bands, units, method and professional sign-off.</Notice>
      <section className="card card-pad">
        <h2 className="text-xl">Records that can&rsquo;t be used for recommendations</h2>
        <ul className="mt-3 divide-y divide-ivory-300 text-sm">
          {data.blocked.map((b) => (
            <li key={b.id} className="py-2"><span className="font-medium">{b.variant_name}</span> <Badge tone={statusTone(b.review_status)}>{b.review_status}</Badge>
              {b.missing.length > 0 && <p className="text-xs text-ink-faint">Missing/unverified: {b.missing.join(", ")}</p>}
              {b.conflicts.map((c) => <p key={c} className="text-xs text-clay-700">{c}</p>)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function EntityTab({ kind, records, act }: { kind: EntityKind; records: Record<string, unknown>[]; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; text: string } | null>(null);
  const statuses = ENTITY_STATUSES[kind];
  const filtered = useMemo(() => records.filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())), [records, q]);
  const titleOf = (r: Record<string, unknown>) => String(r.variant_name ?? r.name ?? r.title ?? r.use_description ?? r.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor={`q-${kind}`}>Search</label>
        <input id={`q-${kind}`} className="input mt-0 max-w-sm" placeholder="Search records…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={() => setEditing({ id: null, text: JSON.stringify(records[0] ? { ...records[0], id: `${String(records[0].id)}-copy` } : {}, null, 2) })}>New (from template)</button>
      </div>
      {editing && (
        <div className="card card-pad space-y-2">
          <p className="text-sm font-medium">{editing.id ? `Editing ${editing.id}` : "New record"} — validated against the {kind} schema on save; every change is logged.</p>
          <textarea aria-label="Record JSON" className="input min-h-[22rem] font-mono text-xs" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} spellCheck={false} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => {
              let record: unknown;
              try { record = JSON.parse(editing.text); } catch { void act(async () => { throw new ApiError("Invalid JSON", 400); }, ""); return; }
              void act(() => api("/api/admin/entity", { body: { kind, record } }), "Saved.").then(() => setEditing(null));
            }}>Save</button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
      <ul className="card divide-y divide-ivory-300">
        {filtered.map((r) => {
          const status = String(r.review_status);
          const fieldStatus = r.field_status as Record<string, string> | undefined;
          return (
            <li key={String(r.id)} className="grid gap-2 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div>
                <p className="font-medium">{titleOf(r)}</p>
                <p className="text-xs text-ink-faint">{String(r.id)}{r.active === false ? " · deactivated" : ""}{"url" in r ? ` · ${String(r.url)}` : ""}{"official_url" in r ? ` · ${String(r.official_url)}` : ""}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={statusTone(status)}>{status}</Badge>
                  {fieldStatus && Object.entries(fieldStatus).map(([f, s]) => <Badge key={f} tone={s === "verified" ? "official" : s === "conflict" ? "caution" : "incomplete"}>{f}: {s}</Badge>)}
                  {"recommendation_eligible" in r && <Badge tone={r.recommendation_eligible ? "reviewed" : "neutral"}>{r.recommendation_eligible ? "recommendation-eligible" : "not eligible"}</Badge>}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {statuses.filter((s) => s !== status).map((s) => (
                  <button key={s} type="button" className="chip border-ivory-300 bg-white py-1 text-ink-soft hover:border-sage-400" onClick={() => void act(() => api("/api/admin/status", { body: { kind, id: r.id, status: s } }), `Set ${String(r.id)} → ${s}`)}>{s.replace("_", " ")}</button>
                ))}
                {"active" in r && (
                  <button type="button" className="chip border-ivory-300 bg-white py-1 text-ink-soft" onClick={() => void act(() => api("/api/admin/entity", { body: { kind, record: { ...r, active: !r.active } } }), r.active ? "Deactivated." : "Reactivated.")}>{r.active ? "deactivate" : "reactivate"}</button>
                )}
                <button type="button" className="chip border-sage-200 bg-sage-50 py-1 text-sage-800" onClick={() => setEditing({ id: String(r.id), text: JSON.stringify(r, null, 2) })}>edit</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ImportsTab({ data, act }: { data: AdminData; act: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const [pid, setPid] = useState(data.kb.products[0]?.id ?? "");
  const [cat, setCat] = useState("nutrition_powder");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const run = (body: unknown, label: string) => act(async () => { const r = await api<Record<string, unknown>>("/api/admin/ingest", { body }); setResult(JSON.stringify(r, null, 2)); }, `${label} finished — see results below.`);
  return (
    <div className="space-y-6">
      <section className="card card-pad space-y-4">
        <h2 className="text-xl">Refresh from official sources</h2>
        <p className="text-sm text-ink-soft">Fetches only allow-listed hosts, respects robots.txt (fails closed if it can&rsquo;t be read), and waits between requests. Changes to age, ingredients or instructions flag the product <em>needs re-review</em> and remove it from recommendations — approved values are never overwritten.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-2"><label className="label" htmlFor="ing-p">One product</label><select id="ing-p" className="input" value={pid} onChange={(e) => setPid(e.target.value)}>{data.kb.products.map((p) => <option key={p.id} value={p.id}>{p.variant_name}</option>)}</select><button type="button" className="btn-secondary" onClick={() => void run({ kind: "product", productId: pid }, "Product refresh")}>Refresh product</button></div>
          <div className="space-y-2"><label className="label" htmlFor="ing-c">One category</label><select id="ing-c" className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{["nutrition_powder", "gummies", "snack", "oral_care"].map((c) => <option key={c}>{c}</option>)}</select><button type="button" className="btn-secondary" onClick={() => void run({ kind: "category", category: cat }, "Category refresh")}>Refresh category</button></div>
          <div className="space-y-2"><p className="label">Everything</p><p className="hint">All active catalogue products.</p><button type="button" className="btn-secondary" onClick={() => void run({ kind: "all" }, "Full refresh")}>Refresh all</button></div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2"><label className="label" htmlFor="ing-u">Import a new official URL</label><input id="ing-u" className="input" placeholder="https://ourlittlejoys.com/product/…" value={url} onChange={(e) => setUrl(e.target.value)} /><button type="button" className="btn-secondary" disabled={!url} onClick={() => void run({ kind: "url", url }, "URL import")}>Import to staging</button></div>
          <div className="space-y-2"><p className="label">Discover via sitemap</p><p className="hint">Lists official product URLs not yet in the catalogue. Nothing is imported automatically.</p><button type="button" className="btn-secondary" onClick={() => void run({ kind: "discover", sitemapUrl: "https://ourlittlejoys.com/sitemap.xml", limit: 300 }, "Discovery")}>Discover</button></div>
        </div>
        {result && <pre className="max-h-72 overflow-auto rounded-xl bg-ink p-3 text-xs text-ivory">{result}</pre>}
      </section>
      <section>
        <h2 className="mb-2 text-xl">Staged imports</h2>
        <ul className="card divide-y divide-ivory-300">
          {data.imports.length === 0 && <li className="p-4 text-sm text-ink-faint">No imports yet.</li>}
          {data.imports.map((i) => (
            <li key={i.id} className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={i.status === "changed" ? "caution" : i.status === "failed" ? "caution" : i.status === "approved" ? "reviewed" : "neutral"}>{i.status}</Badge>
                <a href={i.url} target="_blank" rel="noopener noreferrer" className="break-all">{i.url}</a>
                <span className="text-xs text-ink-faint">{i.fetched_at.slice(0, 16).replace("T", " ")}{i.matched_product_id ? ` · ${i.matched_product_id}` : " · no catalogue match"}</span>
              </div>
              {i.error && <p className="text-xs text-clay-700">{i.error}</p>}
              {i.missing_fields.length > 0 && <p className="text-xs text-ink-faint">Not found on page: {i.missing_fields.join(", ")}</p>}
              {i.diff.length > 0 && (
                <table className="w-full table-fixed text-xs">
                  <thead><tr className="text-left text-ink-faint"><th className="w-32 py-1">Field</th><th>Approved value</th><th>Newly extracted (unreviewed)</th></tr></thead>
                  <tbody>{i.diff.map((d) => <tr key={d.field} className="align-top"><td className="py-1 font-medium">{d.field}{d.critical ? " ⚠" : ""}</td><td className="break-words pr-2">{JSON.stringify(d.previous)}</td><td className="break-words">{JSON.stringify(d.next)}</td></tr>)}</tbody>
                </table>
              )}
              {(i.status === "changed" || i.status === "new") && (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void act(() => api(`/api/admin/imports/${i.id}`, { body: { action: "approve" } }), "Import marked reviewed. Now edit the product record with the new values and approve it.")}>Mark reviewed</button>
                  <button type="button" className="btn-danger py-1 text-xs" onClick={() => void act(() => api(`/api/admin/imports/${i.id}`, { body: { action: "reject" } }), "Import rejected; previous product status restored.")}>Reject change</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ChangeLogTab({ entries }: { entries: ChangeLogEntry[] }) {
  return (
    <ul className="card divide-y divide-ivory-300 text-xs">
      {entries.length === 0 && <li className="p-4 text-ink-faint">No changes recorded yet.</li>}
      {entries.map((e) => (
        <li key={e.id} className="grid gap-1 p-3 md:grid-cols-[10rem_1fr]">
          <span className="text-ink-faint">{e.changed_at.slice(0, 19).replace("T", " ")} · {e.changed_by}</span>
          <span>
            <strong>{e.entity_type}/{e.entity_id}</strong>{e.field ? ` · ${e.field}` : " · created"} {e.critical && <Badge tone="caution">critical</Badge>}
            {e.field && <span className="block break-words text-ink-soft">{JSON.stringify(e.previous_value)?.slice(0, 160)} → {JSON.stringify(e.new_value)?.slice(0, 160)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
