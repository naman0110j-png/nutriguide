import { Suspense } from "react";
import { Catalogue } from "@/components/Catalogue";
import { Loading } from "@/components/ui";

export const metadata = { title: "Product catalogue" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Catalogue />
    </Suspense>
  );
}
