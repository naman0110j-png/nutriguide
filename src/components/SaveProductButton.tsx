"use client";
import { useSaved } from "@/lib/client/store";

export function SaveProductButton({ id }: { id: string }) {
  const saved = useSaved();
  const on = saved.has("product", id);
  return (
    <button type="button" className={on ? "btn-secondary" : "btn-ghost"} aria-pressed={on} onClick={() => void saved.add("product", id)}>
      {on ? "✓ Saved" : "Save product info"}
    </button>
  );
}
