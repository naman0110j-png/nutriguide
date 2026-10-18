import { json, readJson, route } from "@/lib/server/http";
import { RecommendationRequestSchema, recommendationsFor } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("recommendations", async (req: Request) => {
  const input = RecommendationRequestSchema.parse(await readJson(req));
  return json(await recommendationsFor(input));
});
