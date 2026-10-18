import { json, route } from "@/lib/server/http";
import { getRepository } from "@/lib/repo";
import { clearOwner, getOwnerId } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Deletes every profile and saved item for this browser's owner id, then forgets the id. */
export const DELETE = route("me_delete", async () => {
  const owner = getOwnerId();
  const result = owner ? await getRepository().deleteAllOwnerData(owner) : { profiles: 0, saved: 0 };
  clearOwner();
  return json({ deleted: result });
});
