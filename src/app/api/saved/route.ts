import { json, readJson, route } from "@/lib/server/http";
import { SavedItemSchema } from "@/lib/schemas";
import { getRepository } from "@/lib/repo";
import { getOrCreateOwnerId, getOwnerId } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const GET = route("saved_list", async () => {
  const owner = getOwnerId();
  return json({ items: owner ? await getRepository().listSaved(owner) : [] });
});

/** Called only by the client when the parent has consented to saving. */
export const POST = route("saved_add", async (req: Request) => {
  const item = SavedItemSchema.parse(await readJson(req));
  const owner = getOrCreateOwnerId();
  return json({ item: await getRepository().addSaved(owner, item) });
});
