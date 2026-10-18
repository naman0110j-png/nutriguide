import Link from "next/link";
import { DEMO_PROFILES } from "@/data/seed";
import { DemoPicker } from "@/components/DemoPicker";

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="eyebrow mb-4">A thoughtful companion for everyday feeding</p>
          <h1 className="text-4xl leading-[1.08] sm:text-5xl lg:text-[3.4rem]">
            Practical food ideas built from <em className="text-sage-700">what you tell us</em> about your child.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
            Tell us your child&rsquo;s age, diet, allergies and the foods they love or refuse. We&rsquo;ll suggest a few practical ideas, show the official instructions for products you already use, and say clearly what we can&rsquo;t know.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/onboarding" className="btn-primary px-6 py-3 text-base">Build my child&rsquo;s profile</Link>
            <a href="#demo" className="btn-secondary px-6 py-3 text-base">Try a demo profile</a>
          </div>
          <p className="mt-4 text-sm text-ink-faint">About 4 minutes · no sign-up · nothing is saved unless you choose to</p>
        </div>
        <div className="card card-pad relative overflow-hidden">
          <div aria-hidden className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-sage-100" />
          <div aria-hidden className="absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-clay-50" />
          <div className="relative space-y-4">
            <p className="eyebrow">An example of what you&rsquo;ll see</p>
            <blockquote className="font-display text-xl leading-snug text-ink">
              &ldquo;You told us your child is five, follows a vegetarian diet, often refuses green vegetables and currently uses Nutrimix 2–6.&rdquo;
            </blockquote>
            <ul className="space-y-2 text-sm text-ink-soft">
              <li className="flex gap-2"><span className="text-sage-700">●</span> Three ideas that pass age, diet and allergy checks</li>
              <li className="flex gap-2"><span className="text-mist-600">●</span> The pack instruction, word for word, with its source</li>
              <li className="flex gap-2"><span className="text-clay-500">●</span> What we can&rsquo;t tell you — and who can</li>
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="what" className="grid gap-4 md:grid-cols-3">
        <h2 id="what" className="sr-only">What NutriGuide does</h2>
        {[
          { t: "Understands your routine", d: "A short questionnaire about meals, textures, time and the products you already have. Skip anything you don't know." },
          { t: "Solves a specific problem", d: "Bored of the same drink? Ten minutes for breakfast? Milk allergy? Pick the problem and get two or three ideas — not a rigid meal plan." },
          { t: "Shows its working", d: "Every idea says whether it has been reviewed, where it came from, and why it fits. Product facts link to the official page." },
        ].map((x) => (
          <div key={x.t} className="card card-pad">
            <h3 className="text-lg">{x.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{x.d}</p>
          </div>
        ))}
      </section>

      <section className="card card-pad grid gap-6 border-sage-200 bg-sage-50/60 md:grid-cols-[auto_1fr]" aria-labelledby="limits">
        <div aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-white font-display text-xl text-sage-700">i</div>
        <div>
          <h2 id="limits" className="text-xl">Educational support — not a diagnosis</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
            NutriGuide can&rsquo;t tell whether your child has a deficiency, needs a supplement, or is growing as expected. A questionnaire can&rsquo;t show that. When something needs a professional, we say so plainly. You never need to buy anything to get useful ideas, and products only appear when you ask about them and every safety check passes.
          </p>
        </div>
      </section>

      <section id="demo" aria-labelledby="demo-title" className="scroll-mt-24">
        <p className="eyebrow mb-2">Demo mode</p>
        <h2 id="demo-title" className="text-2xl sm:text-3xl">Explore with a synthetic profile</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-soft">These children don&rsquo;t exist. Each profile shows a different part of the safety logic.</p>
        <DemoPicker demos={DEMO_PROFILES.map(({ key, title, blurb }) => ({ key, title, blurb }))} />
      </section>
    </div>
  );
}
