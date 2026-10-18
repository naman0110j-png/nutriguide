"use client";
import { useState } from "react";
import { api, store } from "@/lib/client/store";
import { Notice } from "@/components/ui";

export function DeleteData() {
  const [msg, setMsg] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="card card-pad space-y-4" aria-labelledby="delete-title">
      <h2 id="delete-title" className="text-xl">Delete your data</h2>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-secondary" onClick={() => { store.clearAll(); setMsg("Cleared everything stored in this browser tab."); }}>Clear this tab&rsquo;s data</button>
        {!confirm ? (
          <button type="button" className="btn-danger" onClick={() => setConfirm(true)}>Delete saved profiles &amp; ideas</button>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm">This permanently deletes everything saved from this browser.</span>
            <button type="button" className="btn-danger" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const r = await api<{ deleted: { profiles: number; saved: number } }>("/api/me", { method: "DELETE" });
                store.clearAll();
                setMsg(`Deleted ${r.deleted.profiles} saved profile(s) and ${r.deleted.saved} saved item(s), and cleared this tab.`);
              } catch {
                setMsg("We couldn't reach the server to delete saved data. Please try again.");
              } finally {
                setBusy(false);
                setConfirm(false);
              }
            }}>Yes, delete</button>
            <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
          </span>
        )}
      </div>
      {msg && <Notice tone="info">{msg}</Notice>}
    </section>
  );
}
