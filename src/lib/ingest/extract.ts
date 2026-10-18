/**
 * Heuristic extraction from an official product page. Everything extracted is
 * UNREVIEWED: it goes to a staging record, never straight into an approved product.
 */
export interface ExtractedProduct {
  url: string;
  canonical_url: string | null;
  title: string | null;
  meta_description: string | null;
  age_label: string | null;
  age_min_months: number | null;
  age_max_months: number | null;
  instructions_text: string | null;
  ingredients_text: string | null;
  json_ld_name: string | null;
  price_inr: string | null;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style[\s\S]*?<\/style>/gi, "\n")
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function attr(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? decode(m[1]).trim() : null;
}

export function parseAge(label: string | null): { min: number | null; max: number | null } {
  if (!label) return { min: null, max: null };
  const range = label.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:yr|yrs|year|years)/i);
  if (range) return { min: Number(range[1]) * 12, max: Number(range[2]) * 12 + 11 };
  const plus = label.match(/(\d{1,2})\s*\+\s*(?:yr|yrs|year|years)?/i);
  if (plus) return { min: Number(plus[1]) * 12, max: null };
  return { min: null, max: null };
}

export function extractProductPage(html: string, url: string): ExtractedProduct {
  const text = htmlToText(html);
  const canonical = attr(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) ?? attr(html, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const meta = attr(html, /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  const price = attr(html, /<meta[^>]+property=["']product:price:amount["'][^>]*content=["']([^"']*)["']/i);

  // Age: the first "N-M Yr" / "N+ Yr" label in page text is the selected variant's badge.
  const ageMatch = text.match(/\b(\d{1,2}\s*[-–]\s*\d{1,2}\s*Yrs?|\d{1,2}\s*\+\s*Yrs?)\b/i);
  const ageLabel = ageMatch ? ageMatch[1].replace(/\s+/g, " ") : null;
  const age = parseAge(ageLabel);

  // Instructions: FAQ "How to prepare …?" answer, else the line after "How to Use".
  let instructions: string | null = null;
  const prep = text.match(/How to prepare[^?\n]*\?\s*\n?\s*([^\n]{10,300})/i);
  if (prep) instructions = prep[1].trim();
  if (!instructions) {
    const htu = text.match(/How to Use\s*\n\s*([^\n]{10,300})/i);
    if (htu) instructions = htu[1].trim();
  }

  // Ingredients: the paragraph after a "List of Ingredients" heading.
  let ingredients: string | null = null;
  const ing = text.match(/List of Ingredients\s*\n?\s*([^\n]{10,1200})/i);
  if (ing) ingredients = ing[1].trim();

  let jsonLdName: string | null = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      const product = items.find((x) => x && (x["@type"] === "Product" || (Array.isArray(x["@type"]) && x["@type"].includes("Product"))));
      if (product?.name) jsonLdName = String(product.name);
    } catch {
      /* ignore malformed JSON-LD */
    }
  }

  return {
    url,
    canonical_url: canonical ? new URL(canonical, url).toString() : null,
    title,
    meta_description: meta,
    age_label: ageLabel,
    age_min_months: age.min,
    age_max_months: age.max,
    instructions_text: instructions,
    ingredients_text: ingredients,
    json_ld_name: jsonLdName,
    price_inr: price,
  };
}

export function parseSitemap(xml: string): { kind: "index" | "urlset"; locs: string[] } {
  const kind = /<sitemapindex/i.test(xml) ? "index" : "urlset";
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]));
  return { kind, locs: [...new Set(locs)] };
}
