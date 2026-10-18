import { json, route } from "@/lib/server/http";
import { getConfig, publicStatus } from "@/lib/server/config";

export const dynamic = "force-dynamic";

export const GET = route("status", async () => {
  const cfg = getConfig();
  // Config issues are generic messages (no secret values).
  return json({ ...publicStatus(), configIssues: cfg.configIssues });
});
