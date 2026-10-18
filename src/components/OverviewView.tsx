"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Overview } from "@/lib/engine/overview";
import { api, ApiError, store, useProfile } from "@/lib/client/store";
import { Badge, FeedbackButtons, Loading, Notice, Section, SOURCE_LABEL } from "@/components/ui";
import { NoProfile } from "@/components/NoProfile";

export function OverviewView() {
  const [profile, loaded] = useProfile();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    const ctrl = new AbortController();
    setError(null);
    api<{ overview: Overview }>("/api/overview", { body: { profile }, signal: ctrl.signal })
      .then((r) => setOverview(r.overview))
      .catch((e) => { if (e.name !== "AbortError") setError(e instanceof ApiError ? e.message : "We couldn't build the overview."); });
    return () => ctrl.abort();
  }, [profile]);

  if (!loaded) return <Loading />;
  if (!profile) return <NoProfile />;
  if (error) return <Notice tone="error" title="Something went wrong">{error} <button className="underline" onClick={() => location.reload()}>Try again</button></Notice>;
  if (!overview) return <Loading label="Putting your overview together…" />;

  const savedId = store.getSavedId();
  const groups = ["parent_reported", "verified_product", "calculated", "general_education"] as const;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your nutrition overview</p>
          <h1 className="mt-2 text-3xl sm:text-4xl">{profile.nickname ? `For ${profile.nickname}` : "For your child"}</h1>
          <p className="mt-1 text-sm text-ink-faint">
            {profile.is_demo ? "Synthetic demo profile" : savedId ? "Saved profile" : "Temporary — this tab only"} · <Link href="/onboarding?step=review">Edit profile</Link>
          </p>
        </div>
        <Link href={overview.next_actions[0]?.href ?? "/workspace"} className="btn-primary">Explore food ideas →</Link>
      </header>

      <Section id="summary" eyebrow="1 · Summary" title="What you told us">
        <p className="max-w-3xl font-display text-lg leading-relaxed text-ink sm:text-xl">{overview.summary}</p>
        {overview.concerns.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {overview.concerns.map((c) => (
              <span key={c.type} className="chip border-ivory-300 bg-white py-1 text-ink-soft">
                {c.name} <span className="text-ink-faint">· {c.nutrient ? "parent-reported, not clinically assessed" : "parent-reported"}</span>
              </span>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Section id="known" eyebrow="2 · What we know" title="Facts and where they come from">
          <div className="space-y-5">
            {groups.map((g) => {
              const facts = overview.known.filter((k) => k.source === g);
              return (
                <div key={g}>
                  <Badge tone={SOURCE_LABEL[g].tone}>{SOURCE_LABEL[g].text}</Badge>
                  {facts.length ? (
                    <dl className="mt-2 divide-y divide-ivory-300 text-sm">
                      {facts.map((f, i) => (
                        <div key={`${f.label}-${i}`} className="grid gap-1 py-2 sm:grid-cols-[11rem_1fr]">
                          <dt className="text-ink-faint">{f.label}</dt>
                          <dd>{f.value}{f.source_url && <> · <a href={f.source_url} target="_blank" rel="noopener noreferrer">official page</a></>}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="mt-2 text-sm text-ink-faint">{g === "calculated" ? overview.calculations_note : g === "general_education" ? "General guidance appears with each food idea." : "None yet."}</p>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <div className="space-y-6">
          <Section id="explore" eyebrow="3 · Areas worth exploring" title="Where small changes might help">
            <ul className="space-y-3">
              {overview.areas_to_explore.map((a, i) => (
                <li key={`${a.title}-${i}`} className="rounded-xl border border-ivory-300 bg-white p-3">
                  <p className="font-medium">{a.title}</p>
                  <p className="mt-0.5 text-sm text-ink-soft">{a.why}</p>
                  <Link href={`/workspace?concern=${a.concern}`} className="mt-1 inline-block text-sm">See ideas →</Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section id="cannot" eyebrow="4 · What we can't determine" title="Limits of this overview">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-soft">
            {overview.cannot_determine.map((c) => <li key={c}>{c}</li>)}
          </ul>
          {overview.information_gaps.length > 0 && (
            <div className="mt-5">
              <p className="text-sm font-medium">Missing details that would help</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">{overview.information_gaps.map((g) => <li key={g}>{g}</li>)}</ul>
              <Link href="/onboarding?step=review" className="mt-2 inline-block text-sm">Add details →</Link>
            </div>
          )}
          <p className="mt-5 text-sm text-ink-soft">A <strong>paediatrician</strong> can assess growth and health; a <strong>registered dietitian</strong> can assess what your child eats in detail.</p>
        </Section>

        <Section id="professional" eyebrow="5 · Next steps" title="Suggested next actions">
          {overview.professional_guidance.length > 0 && (
            <div className="mb-4 space-y-2">
              {overview.professional_guidance.map((g) => <Notice key={g} tone="pro" title="When to involve a professional">{g}</Notice>)}
            </div>
          )}
          <ol className="space-y-2">
            {overview.next_actions.map((a, i) => (
              <li key={a.label}>
                <Link href={a.href} className="flex items-center gap-3 rounded-xl border border-ivory-300 bg-white px-4 py-3 text-sm text-ink no-underline hover:border-sage-400 hover:no-underline">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sage-100 text-xs font-semibold text-sage-800">{i + 1}</span>
                  {a.label}
                </Link>
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <FeedbackButtons type="overview" profileId={savedId} />
    </div>
  );
}
