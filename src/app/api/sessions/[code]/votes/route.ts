import { handle, jsonOk, playerAuth, readJson, requireCode } from "@/lib/api-helpers";
import { assertPlayer, castVote } from "@/lib/game";
import type { VoteKind } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 玩家投一張票（同意或不同意） */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const body = await readJson<{ targetId?: string; kind?: VoteKind }>(req);
    return jsonOk(
      await castVote(code, playerId, body.targetId ?? "", (body.kind ?? "approve") as VoteKind),
    );
  });
}
