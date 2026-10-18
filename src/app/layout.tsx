import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/dm-sans";
import "./globals.css";
import { publicStatus } from "@/lib/server/config";
import { MobileNav } from "@/components/MobileNav";

export const metadata: Metadata = {
  title: { default: "NutriGuide — practical food ideas for your child", template: "%s · NutriGuide" },
  description: "An educational companion that turns what you tell us about your child into practical, age-appropriate food ideas and clear product information. Not a diagnostic tool.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#FBF7F0" };

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/onboarding", label: "Profile" },
  { href: "/overview", label: "Overview" },
  { href: "/workspace", label: "Food ideas" },
  { href: "/products", label: "Products" },
  { href: "/saved", label: "Saved" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const status = publicStatus();
  return (
    <html lang="en-IN">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        {status.demo && (
          <div role="status" className="border-b border-clay-100 bg-clay-50 px-4 py-2 text-center text-xs text-clay-700">
            <strong className="font-semibold">Demo mode.</strong>{" "}
            {status.aiLive ? "AI explanations are live; " : "No AI provider configured — explanations use reviewed templates; "}
            {status.contentMode === "demo" ? "unreviewed recipe concepts are shown with clear labels. " : ""}
            Nothing here has been reviewed by a nutrition professional.
          </div>
        )}
        <header className="sticky top-0 z-30 border-b border-ivory-300/70 bg-ivory/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" className="flex items-center gap-2 no-underline hover:no-underline" aria-label="NutriGuide home">
              <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-sage-700 font-display text-base text-white">n</span>
              <span className="font-display text-lg text-ink">NutriGuide</span>
              <span className="hidden text-xs text-ink-faint sm:inline">· for Little Joys families</span>
            </Link>
            <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-sm text-ink-soft no-underline hover:bg-ivory-200 hover:text-ink hover:no-underline">
                  {n.label}
                </Link>
              ))}
            </nav>
            <MobileNav items={NAV} />
          </div>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
          {children}
        </main>
        <footer className="border-t border-ivory-300/70 bg-ivory-100">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-xs text-ink-soft sm:grid-cols-3 sm:px-6">
            <p className="sm:col-span-2">
              NutriGuide is an independent educational prototype inspired by the Little Joys range. It is <strong>not affiliated with or endorsed by Mosaic Wellness or Little Joys</strong>, and it does not diagnose, treat or prescribe. For anything specific to your child, please speak to a paediatrician or registered dietitian.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
              <Link href="/privacy">Privacy &amp; your data</Link>
              <Link href="/products">Product sources</Link>
              <Link href="/admin" prefetch={false}>Content review</Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
