"use client";
/**
 * Client-side profile state. By default the profile lives only in this tab
 * (sessionStorage) and disappears when the tab closes. It is sent to the server
 * for persistent storage ONLY if the parent ticked "Save this profile".
 */
import { useCallback, useEffect, useState } from "react";
import type { ChildProfile } from "@/lib/schemas";

const KEY = "ng.profile.v1";
const DRAFT = "ng.draft.v1";
const SAVED_ID = "ng.profileId.v1";
const LOCAL_SAVED = "ng.saved.v1";
const EVT = "ng-profile-change";

function safeGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function safeSet(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — app still works for this page view */
  }
}

export const store = {
  getProfile: () => safeGet<ChildProfile>(KEY),
  setProfile: (p: ChildProfile | null) => { safeSet(KEY, p); window.dispatchEvent(new Event(EVT)); },
  getDraft: () => safeGet<Partial<ChildProfile>>(DRAFT),
  setDraft: (p: Partial<ChildProfile> | null) => safeSet(DRAFT, p),
  getSavedId: () => safeGet<string>(SAVED_ID),
  setSavedId: (id: string | null) => safeSet(SAVED_ID, id),
  getLocalSaved: () => safeGet<{ id: string; item_type: "recipe" | "product"; item_id: string }[]>(LOCAL_SAVED) ?? [],
  setLocalSaved: (v: { id: string; item_type: "recipe" | "product"; item_id: string }[]) => safeSet(LOCAL_SAVED, v),
  clearAll: () => { [KEY, DRAFT, SAVED_ID, LOCAL_SAVED].forEach((k) => safeSet(k, null)); window.dispatchEvent(new Event(EVT)); },
};

/** Returns [profile, loaded]. `loaded` avoids flashing "no profile" before sessionStorage is read. */
export function useProfile(): [ChildProfile | null, boolean] {
  const [p, setP] = useState<ChildProfile | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const read = () => { setP(store.getProfile()); setLoaded(true); };
    read();
    window.addEventListener(EVT, read);
    return () => window.removeEventListener(EVT, read);
  }, []);
  return [p, loaded];
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: { path: string; message: string }[]) {
    super(message);
  }
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? (init?.body ? "POST" : "GET"),
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: init?.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError("We couldn't reach the server. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: { path: string; message: string }[] };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.issues);
  return data as T;
}

/** Saved ideas: server-side when the parent consented to saving; otherwise this tab only. */
export function useSaved() {
  const [items, setItems] = useState<{ id: string; item_type: "recipe" | "product"; item_id: string }[]>([]);
  const [persistent, setPersistent] = useState(false);
  const refresh = useCallback(async () => {
    const consented = !!store.getSavedId();
    setPersistent(consented);
    if (consented) {
      try {
        const r = await api<{ items: { id: string; item_type: "recipe" | "product"; item_id: string }[] }>("/api/saved");
        setItems(r.items);
        return;
      } catch {
        /* fall back to local list */
      }
    }
    setItems(store.getLocalSaved());
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = useCallback(async (item_type: "recipe" | "product", item_id: string) => {
    if (store.getSavedId()) {
      await api("/api/saved", { body: { item_type, item_id } });
    } else {
      const cur = store.getLocalSaved();
      if (!cur.some((x) => x.item_type === item_type && x.item_id === item_id)) store.setLocalSaved([...cur, { id: `local-${item_type}-${item_id}`, item_type, item_id }]);
    }
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    if (id.startsWith("local-")) store.setLocalSaved(store.getLocalSaved().filter((x) => x.id !== id));
    else await api(`/api/saved/${id}`, { method: "DELETE" });
    await refresh();
  }, [refresh]);

  return { items, persistent, add, remove, has: (t: string, id: string) => items.some((x) => x.item_type === t && x.item_id === id) };
}
