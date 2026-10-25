import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6">
      <Suspense>
        <SignUp />
      </Suspense>
    </main>
  );
}