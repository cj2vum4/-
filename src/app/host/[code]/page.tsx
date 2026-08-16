import { HostConsole } from "./console";

export const dynamic = "force-dynamic";

export default async function HostSessionPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <HostConsole code={decodeURIComponent(code)} />;
}
