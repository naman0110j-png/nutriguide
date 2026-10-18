import { Suspense } from "react";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { Loading } from "@/components/ui";

export const metadata = { title: "Build your child's profile" };

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Onboarding />
    </Suspense>
  );
}
