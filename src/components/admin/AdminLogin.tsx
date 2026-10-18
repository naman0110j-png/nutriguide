"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client/store";
import { Notice } from "@/components/ui";

export function AdminLogin() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card card-pad mx-auto max-w-sm space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          await api("/api/admin/login", { body: { password: pw } });
          router.refresh();
        } catch (e) {
          setErr(e instanceof ApiError ? e.message : "Sign-in failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="text-2xl">Content review sign-in</h1>
      <div>
        <label htmlFor="pw" className="label">Admin password</label>
        <input id="pw" type="password" autoComplete="current-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <button className="btn-primary w-full" disabled={busy || !pw}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
