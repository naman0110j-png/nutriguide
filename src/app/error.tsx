"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card card-pad mx-auto max-w-lg text-center" role="alert">
      <h1 className="text-2xl">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-soft">This page couldn&rsquo;t load. Your answers in this tab haven&rsquo;t been lost.</p>
      <button type="button" className="btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
