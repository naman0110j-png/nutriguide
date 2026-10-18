import { getConfig } from "@/lib/server/config";
import { isAdmin } from "@/lib/server/auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { AdminConsole } from "@/components/admin/AdminConsole";

export const metadata = { title: "Content review", robots: { index: false } };
export const dynamic = "force-dynamic";

export default function AdminPage() {
  const cfg = getConfig();
  if (!cfg.admin.enabled) {
    return (
      <div className="card card-pad mx-auto max-w-xl">
        <h1 className="text-2xl">Content review is switched off</h1>
        <p className="mt-2 text-sm text-ink-soft">{cfg.admin.reason}</p>
        <p className="mt-2 text-sm text-ink-soft">This keeps administrative write operations unavailable to anonymous visitors. See the README for setup.</p>
      </div>
    );
  }
  if (!isAdmin()) return <AdminLogin />;
  return <AdminConsole configIssues={cfg.configIssues} contentMode={cfg.contentMode} />;
}
