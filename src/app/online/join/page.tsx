import { Suspense } from "react";
import { JoinForm } from "./form";

export const metadata = { title: "線上主持 · 玩家入場" };

export default function Page() {
  return (
    <Suspense>
      <JoinForm />
    </Suspense>
  );
}
