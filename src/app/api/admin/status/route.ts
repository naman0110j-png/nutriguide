import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getRepository } from "@/lib/repo";
import { EntityKindSchema } from "@/lib/repo/types";

export const dynamic = "force-dynamic";

export const POST = route("admin_status", async (req: Request) => {
  requireAdmin();
  const { kind, id, status } = z.object({ kind: EntityKindSchema, id: z.string().min(1).max(120), status: z.string().min(1).max(40) }).parse(await readJson(req));
  return json({ record: await getRepository().setEntityStatus(kind, id, status, "admin") });
});
