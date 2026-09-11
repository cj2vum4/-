import { handle, hostPin, jsonOk, playerAuth, requireCode } from "@/lib/api-helpers";
import { GameError } from "@/lib/errors";
import { assertPlayer, getHostSnapshot, getPlayerSnapshot } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 前端輪詢這支拿最新狀態。
 *
 * 回傳內容依身分而異：主持人拿到全部，玩家只拿到自己的勢力值與血量，
 * 其他人一律只有威望值與勢力值名次。所以這支一定要驗證身分，不能開放匿名讀取。
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);

    const pin = hostPin(req);
    if (pin) {
      // 讀取放行封存場次，主持人按下「結束」後畫面才不會開始噴 404
      const { assertHostReadOnly } = await import("@/lib/game");
      await assertHostReadOnly(code, pin);
      return jsonOk(await getHostSnapshot(code));
    }

    const { playerId, joinCode } = playerAuth(req);
    if (playerId) {
      await assertPlayer(code, playerId, joinCode);
      return jsonOk(await getPlayerSnapshot(code, playerId));
    }

    throw new GameError("UNAUTHORIZED", "需要主持通行碼或玩家身分才能查看場上狀態");
  });
}
