import { z } from "zod";
import { json, readJson, route } from "@/lib/server/http";
import { ChildProfileSchema } from "@/lib/schemas";
import { overviewFor } from "@/lib/server/service";

export const dynamic = "force-dynamic";

export const POST = route("overview", async (req: Request) => {
  const { profile } = z.object({ profile: ChildProfileSchema }).parse(await readJson(req));
  return json({ overview: await overviewFor(profile) });
});
