import { HostConsole } from "./console";

export const dynamic = "force-dynamic";
export const metadata = { title: "線上主持 · 主持台" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostConsole code={decodeURIComponent(code).toUpperCase()} />;
}
