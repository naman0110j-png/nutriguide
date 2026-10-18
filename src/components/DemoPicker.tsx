"use client";
import { useRouter } from "next/navigation";
import { DEMO_PROFILES } from "@/data/seed/demo-profiles";
import { store } from "@/lib/client/store";

export function DemoPicker({ demos }: { demos: { key: string; title: string; blurb: string }[] }) {
  const router = useRouter();
  return (
    <div className="mt-6 grid gap-4 md:grid-cols-3">
      {demos.map((d, i) => (
        <button
          key={d.key}
          type="button"
          className="card card-pad group text-left transition hover:border-sage-400"
          onClick={() => {
            const demo = DEMO_PROFILES.find((x) => x.key === d.key)!;
            store.setProfile(structuredClone(demo.profile));
            store.setSavedId(null);
            router.push("/overview");
          }}
        >
          <span className={`mb-3 inline-block h-1.5 w-10 rounded-full ${["bg-sage-400", "bg-clay-300", "bg-mist-300"][i % 3]}`} aria-hidden />
          <span className="block font-display text-lg text-ink">{d.title}</span>
          <span className="mt-1 block text-sm text-ink-soft">{d.blurb}</span>
          <span className="mt-4 inline-block text-sm font-medium text-sage-700 group-hover:underline">Use this demo profile →</span>
        </button>
      ))}
    </div>
  );
}
