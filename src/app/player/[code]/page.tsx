import { PlayerPanel } from "./panel";

export const dynamic = "force-dynamic";

export default async function PlayerSessionPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <PlayerPanel code={decodeURIComponent(code)} />;
}
