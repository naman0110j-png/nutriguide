import { json, route } from "@/lib/server/http";
import { endAdminSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const POST = route("admin_logout", async () => {
  endAdminSession();
  return json({ ok: true });
});
