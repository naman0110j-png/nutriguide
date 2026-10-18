import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getRepository } from "@/lib/repo";
import { EntityKindSchema } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

/** Create or update a knowledge-base record. Validated against the entity schema; every change is logged. */
export const POST = route("admin_entity", async (req: Request) => {
  requireAdmin();
  const { kind, record } = z.object({ kind: EntityKindSchema, record: z.record(z.unknown()) }).parse(await readJson(req, 200_000));
  const result = await getRepository().upsertEntity(kind, record, "admin");
  return json({ record: result.record, changes: result.changes.length });
});
