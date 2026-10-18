// Browser end-to-end walkthrough (Playwright, real Chromium).
// Usage: BASE=http://localhost:3100 ADMIN_PASSWORD=... CHROMIUM=/path/to/chrome node scripts/e2e.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "e2e-screenshots";
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ["--no-sandbox"] });
const errors = [];

async function run(label, viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label} console: ${m.text()}`); });
  const shot = (n) => page.screenshot({ path: `${OUT}/${label}-${n}.png`, fullPage: true });

  await page.goto(BASE + "/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  check(`${label}: landing renders with diagnosis disclaimer`, await page.getByText("Educational support — not a diagnosis").isVisible());
  check(`${label}: demo banner visible`, await page.getByText("Demo mode.", { exact: false }).first().isVisible());
  await shot("01-landing");

  // Onboarding — keyboard/labels driven
  await page.getByRole("link", { name: /Build my child/ }).click();
  await page.getByRole("heading", { name: "Your child" }).waitFor();
  await page.getByRole("button", { name: "Continue" }).click();
  check(`${label}: inline validation on required age`, await page.getByText("Please enter your child's age").isVisible());
  await page.getByLabel("Age — years *", { exact: true }).fill("4");
  await page.getByLabel("and months", { exact: true }).fill("3");
  await page.getByLabel("Vegetarian with eggs", { exact: true }).check();
  await page.getByLabel("Egg", { exact: true }).check();
  await page.getByLabel("Severity (if known)", { exact: true }).selectOption("mild");
  await page.getByLabel("Foods your child likes", { exact: true }).fill("roti, banana");
  await page.getByLabel("Foods your child likes", { exact: true }).press("Enter");
  await page.getByLabel("Foods your child often refuses", { exact: true }).fill("spinach");
  await page.getByLabel("Foods your child often refuses", { exact: true }).press("Enter");
  await shot("02-onboarding-child");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("heading", { name: "What's on your mind" }).waitFor();
  await page.getByLabel("Picky eating or limited food variety", { exact: true }).check();
  await page.getByLabel("Concern about iron", { exact: true }).check();
  check(`${label}: conditional nutrient follow-up appears`, await page.getByText("Which best describes it?").isVisible());
  await page.getByLabel("A general worry", { exact: true }).check();
  await shot("03-onboarding-concerns");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("heading", { name: "A typical day" }).waitFor();
  await page.getByLabel("Typical breakfast", { exact: true }).fill("Milk and toast");
  await page.getByLabel("About 10 minutes", { exact: true }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("heading", { name: "Products you use" }).waitFor();
  await page.getByLabel("Search the catalogue", { exact: true }).fill("nutrimix 2");
  await page.getByRole("button", { name: "Add" }).first().click();
  await page.getByLabel("How you use it now", { exact: true }).fill("2 scoops in cold milk");
  await shot("04-onboarding-products");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("heading", { name: "How we can help" }).waitFor();
  await page.getByLabel(/Recipe ideas using products you have/).check();
  await page.getByLabel(/Save this profile/).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("heading", { name: "Review" }).waitFor();
  check(`${label}: review shows entered allergy`, await page.getByText("egg (mild)", { exact: false }).isVisible());
  await page.getByRole("button", { name: "Edit Diet" }).click();
  await page.getByRole("heading", { name: "Your child" }).waitFor();
  check(`${label}: edit returns to step with values kept`, (await page.getByLabel("Age — years *", { exact: true }).inputValue()) === "4");
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: /Continue|Skip this step/ }).first().click();
  await page.getByRole("button", { name: "See my overview" }).click();

  await page.getByText("What you told us").waitFor();
  const summary = await page.locator("#summary p.font-display").innerText();
  check(`${label}: overview summary reflects entries`, /4 years 3 months/.test(summary) && /eggs/.test(summary) && /spinach/.test(summary), summary.slice(0, 90));
  check(`${label}: overview labels parent vs official facts`, (await page.getByText("Reported by you").count()) > 0 && (await page.getByText("Official product information").count()) > 0);
  check(`${label}: 'what we can't determine' present`, await page.getByText("Whether your child has any nutrient deficiency.").isVisible());
  await shot("05-overview");

  // Workspace
  await page.goto(BASE + "/workspace?concern=product_question");
  await page.getByRole("heading", { name: "Using a product I already have" }).waitFor({ timeout: 15000 });
  const cards = await page.locator("article").count();
  check(`${label}: workspace shows recipe cards`, cards > 0, `${cards} cards`);
  check(`${label}: official instruction beside parent routine`, await page.getByText("2 scoops in cold milk").isVisible());
  await page.getByRole("button", { name: "Show ingredients & steps" }).first().click();
  check(`${label}: recipe details expand`, await page.getByRole("heading", { name: "Steps" }).first().isVisible());
  await page.getByRole("button", { name: "Save idea" }).first().click();
  await page.getByRole("button", { name: "✓ Saved" }).first().waitFor();
  check(`${label}: idea saved`, true);
  await page.getByLabel("Your question", { exact: true }).fill("How many scoops should I give?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByText("Needs a professional").waitFor({ timeout: 15000 });
  check(`${label}: chat dosing guard`, true);
  await page.getByLabel("Your question", { exact: true }).fill("Can you suggest another snack idea?");
  await page.getByRole("button", { name: "Send" }).click();
  await page.waitForTimeout(1200);
  await shot("06-workspace");

  await page.goto(BASE + "/workspace?concern=picky_eating");
  await page.getByRole("heading", { name: "Picky eating or limited food variety" }).waitFor({ timeout: 15000 });
  const bodyText = await page.locator("main").innerText();
  check(`${label}: egg allergy respected in visible ideas`, !/Soft scrambled egg/.test(bodyText.split("Why")[0]));

  // Catalogue + detail
  await page.goto(BASE + "/products");
  await page.getByRole("link", { name: /Nutrimix 2–6 Years · Chocolate/ }).first().waitFor();
  await page.getByRole("button", { name: "Oral care" }).click();
  await page.waitForTimeout(500);
  check(`${label}: category filter`, (await page.getByText("Oral care — not nutrition").count()) >= 1 && (await page.getByText("Nutrimix 2–6").count()) === 0);
  await shot("07-catalogue");
  await page.goto(BASE + "/products/lj-multivitamin-toothpaste-5plus-80g");
  check(`${label}: product detail shows source conflict`, await page.getByText(/Fluoride: page metadata says/).isVisible());
  await shot("08-product-detail");

  await page.goto(BASE + "/saved");
  await page.waitForTimeout(800);
  check(`${label}: saved page lists saved idea`, (await page.getByRole("button", { name: "Remove" }).count()) >= 1);

  await page.goto(BASE + "/privacy");
  await page.getByRole("button", { name: /Delete saved profiles/ }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await page.getByText(/Deleted 1 saved profile/).waitFor();
  check(`${label}: profile deletion from privacy page`, true);
  await page.goto(BASE + "/overview");
  check(`${label}: after deletion no profile remains`, await page.getByText("start with your child").isVisible());

  // Under-two demo via landing
  await page.goto(BASE + "/#demo");
  await page.getByRole("button", { name: /18-month-old/ }).click();
  await page.getByText("What you told us").waitFor();
  await page.goto(BASE + "/workspace?concern=iron");
  await page.getByText(/under two/i).first().waitFor({ timeout: 15000 });
  check(`${label}: under-two safeguard visible`, (await page.locator("article").count()) === 0);
  await shot("09-under-two");

  await ctx.close();
}

await run("desktop", { width: 1360, height: 900 });
await run("mobile", { width: 390, height: 844 });

// Admin (desktop)
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + "/admin");
if (process.env.ADMIN_PASSWORD) {
  await page.getByLabel("Admin password", { exact: true }).fill(process.env.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Knowledge base" }).waitFor();
  check("admin: console loads", true);
  await page.getByRole("button", { name: "Products", exact: true }).click();
  await page.getByText("lj-calcium-gummies-strawberry-4-6-30n").waitFor();
  check("admin: product list with missing-field indicators", (await page.getByText("instructions: missing").count()) > 0);
  await page.screenshot({ path: `${OUT}/admin-products.png`, fullPage: false });
  await page.getByRole("button", { name: "Imports & refresh" }).click();
  await page.screenshot({ path: `${OUT}/admin-imports.png`, fullPage: false });
}
await ctx.close();
await browser.close();

// "Failed to fetch RSC payload … Falling back to browser navigation" is Next.js recovering from a
// link prefetch that this script aborts by calling page.goto() mid-prefetch. It is not an app error.
const relevant = errors.filter((e) => !/favicon|404 \(Not Found\)|Failed to fetch RSC payload.*Falling back to browser navigation/.test(e));
check("no uncaught page errors", relevant.length === 0, relevant.slice(0, 3).join(" | "));
console.log(`\n${pass}/${pass + fail} browser checks passed`);
process.exit(fail ? 1 : 0);
