import { DeleteData } from "@/components/DeleteData";
import { publicStatus } from "@/lib/server/config";

export const metadata = { title: "Privacy & your data" };

export default function Privacy() {
  const s = publicStatus();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="eyebrow">Privacy</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Your data, in plain words</h1>
      </header>
      <section className="card card-pad space-y-4 text-sm leading-relaxed text-ink-soft">
        <div>
          <h2 className="text-lg text-ink">What we ask for</h2>
          <p>Age in years and months, diet, allergies you know about, foods and textures, a rough daily routine, concerns, and products you use. We never ask for your child&rsquo;s full name, date of birth, school, address or photos. A nickname is optional.</p>
        </div>
        <div>
          <h2 className="text-lg text-ink">Where it is kept</h2>
          <p><strong>By default, only in this browser tab</strong> (session storage). It disappears when you close the tab. It is sent to our server only to work out ideas for each request, and isn&rsquo;t stored there.</p>
          <p className="mt-2">If you tick <em>Save this profile</em>, it is stored on our server and linked to an anonymous ID in a secure cookie on this browser. Nobody else can read it with their browser. {s.dataBackend === "supabase" ? "Storage uses a PostgreSQL database with row-level security." : "This demo deployment uses a local file store on the server — fine for demos, not for real family data."}</p>
        </div>
        <div>
          <h2 className="text-lg text-ink">AI explanations</h2>
          <p>Only if you allow it <em>and</em> an AI provider is configured {s.aiLive ? `(currently: ${s.aiProvider})` : "(currently: none — this deployment uses templates)"}. We send de-identified details: age in months, diet, allergy types, concern types, likes and refusals. Never the nickname or anything you typed into free-text boxes. The AI only words explanations; it never decides what is shown.</p>
        </div>
        <div>
          <h2 className="text-lg text-ink">Logs and feedback</h2>
          <p>Server logs record events and timings, not your answers. Feedback is stored without your profile unless you saved one, and you&rsquo;re asked not to include names.</p>
        </div>
      </section>
      <DeleteData />
    </div>
  );
}
