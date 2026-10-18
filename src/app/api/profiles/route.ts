import { z } from "zod";
import { HttpError, json, readJson, route } from "@/lib/server/http";
import { ChildProfileSchema } from "@/lib/schemas";
import { getRepository } from "@/lib/repo";
import { getOrCreateOwnerId, getOwnerId } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Save requires explicit consent (profile.consent.persist === true). */
export const POST = route("profiles_save", async (req: Request) => {
  const { profile, id } = z.object({ profile: ChildProfileSchema, id: z.string().uuid().optional() }).parse(await readJson(req));
  if (!profile.consent.persist) throw new HttpError(400, "Saving needs your permission. Tick “Save this profile” first, or keep using it temporarily.");
  const owner = getOrCreateOwnerId();
  const saved = await getRepository().saveProfile(owner, { ...profile, is_demo: profile.is_demo }, id);
  return json({ id: saved.id, updated_at: saved.updated_at });
});

export const GET = route("profiles_list", async () => {
  const owner = getOwnerId();
  if (!owner) return json({ items: [] });
  const items = await getRepository().listProfiles(owner);
  return json({ items: items.map((p) => ({ id: p.id, profile: p.profile, updated_at: p.updated_at })) });
});
