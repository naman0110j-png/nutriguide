import { json, readJson, route } from "@/lib/server/http";
import { ChatRequestSchema, chatFor } from "@/lib/server/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = route("chat", async (req: Request) => {
  const input = ChatRequestSchema.parse(await readJson(req));
  return json(await chatFor(input));
});
