import { Suspense } from "react";
import { Workspace } from "@/components/workspace/Workspace";
import { Loading } from "@/components/ui";

export const metadata = { title: "Food ideas" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Workspace />
    </Suspense>
  );
}
