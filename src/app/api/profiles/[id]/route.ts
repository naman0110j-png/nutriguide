import { HttpError, json, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repo";
import { getOwnerId } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const GET = route("profile_get", async (_req: Request, { params }: { params: { id: string } }) => {
  const owner = getOwnerId();
  // Same response for "not yours" and "doesn't exist" — no probing of other owners' ids.
  const p = owner ? await getRepository().getProfile(owner, params.id) : null;
  if (!p) throw new HttpError(404, "Profile not found. It may have been deleted, or it belongs to another browser.");
  return json({ id: p.id, profile: p.profile, updated_at: p.updated_at });
});

export const DELETE = route("profile_delete", async (_req: Request, { params }: { params: { id: string } }) => {
  const owner = getOwnerId();
  const ok = owner ? await getRepository().deleteProfile(owner, params.id) : false;
  if (!ok) throw new HttpError(404, "Profile not found.");
  return json({ deleted: true });
});
