import Link from "next/link";

export function NoProfile() {
  return (
    <div className="card card-pad mx-auto max-w-xl text-center">
      <h1 className="text-2xl">Let&rsquo;s start with your child&rsquo;s profile</h1>
      <p className="mt-2 text-sm text-ink-soft">We need a few details first. Nothing is saved unless you choose to save it. If you had a profile open earlier, it may have been cleared when the tab closed.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link href="/onboarding" className="btn-primary">Build a profile</Link>
        <Link href="/#demo" className="btn-secondary">Use a demo profile</Link>
      </div>
    </div>
  );
}
