import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { FeedbackSchema } from "@/lib/schemas";
import { getRepository } from "@/lib/repo";
import { getOwnerId } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const POST = route("feedback", async (req: Request) => {
  const body = FeedbackSchema.extend({ profile_id: z.string().uuid().nullable().optional() }).parse(await readJson(req));
  const { profile_id, ...fb } = body;
  // Only link feedback to a profile this browser actually owns.
  let linked: string | null = null;
  const owner = getOwnerId();
  if (profile_id && owner && (await getRepository().getProfile(owner, profile_id))) linked = profile_id;
  const saved = await getRepository().addFeedback(linked, fb);
  return json({ id: saved.id });
});
