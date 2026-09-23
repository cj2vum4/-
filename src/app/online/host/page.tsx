import { Suspense } from "react";
import { HostEntry } from "./entry";

export const metadata = { title: "線上主持 · 主持人" };

export default function Page() {
  return (
    <Suspense>
      <HostEntry />
    </Suspense>
  );
}
