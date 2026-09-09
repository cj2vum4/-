import { handle, jsonOk, playerAuth, readJson, requireCode } from "@/lib/api-helpers";
import { assertPlayer, submitReport } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 玩家提出舉報。判定由主持人操作，威望值要等下次開啟招募才生效。 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const body = await readJson<{ targetId?: string; clueCode?: string }>(req);
    const report = await submitReport(
      code,
      playerId,
      body.targetId ?? "",
      body.clueCode ?? "",
    );
    return jsonOk({ report: { id: report.id, targetName: report.targetName } });
  });
}
