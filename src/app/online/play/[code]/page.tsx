import { Suspense } from "react";
import { PlayerApp } from "./player";

export const dynamic = "force-dynamic";
export const metadata = { title: "線上主持 · 玩家" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <Suspense>
      <PlayerApp code={decodeURIComponent(code).toUpperCase()} />
    </Suspense>
  );
}
