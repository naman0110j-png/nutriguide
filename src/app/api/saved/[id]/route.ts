import { HttpError, json, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repo";
import { getOwnerId } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const DELETE = route("saved_remove", async (_req: Request, { params }: { params: { id: string } }) => {
  const owner = getOwnerId();
  const ok = owner ? await getRepository().removeSaved(owner, params.id) : false;
  if (!ok) throw new HttpError(404, "Saved item not found.");
  return json({ removed: true });
});
