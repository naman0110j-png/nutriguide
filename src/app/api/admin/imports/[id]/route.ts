import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getRepository } from "@/lib/repo";

export const dynamic = "force-dynamic";

/**
 * approve: marks the staged import as reviewed. Approved product data is NOT overwritten —
 *          the admin edits the product record (with the extracted values beside it) and
 *          then approves the product.
 * reject:  discards the staged values and restores the product's previous review status.
 */
export const POST = route("admin_import_action", async (req: Request, { params }: { params: { id: string } }) => {
  requireAdmin();
  const { action } = z.object({ action: z.enum(["approve", "reject"]) }).parse(await readJson(req));
  const repo = getRepository();
  const imp = await repo.getImport(params.id);
  if (!imp) throw new HttpError(404, "Import not found.");
  const saved = await repo.saveImport({ ...imp, status: action === "approve" ? "approved" : "rejected" });
  if (action === "reject" && imp.matched_product_id) {
    const ex = imp.extracted as Record<string, unknown>;
    const kb = await repo.getKnowledgeBase();
    const product = kb.products.find((p) => p.id === imp.matched_product_id);
    if (product && typeof ex.previous_review_status === "string") {
      await repo.upsertEntity("products", {
        ...product,
        review_status: ex.previous_review_status,
        recommendation_eligible: ex.previous_review_status === "approved" && ex.previous_recommendation_eligible === true,
        notes: product.notes.filter((n) => !n.startsWith("Source changed")),
      }, "admin");
    }
  }
  return json({ import: saved });
});
