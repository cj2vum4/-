import { handle, hostPin, jsonOk } from "@/lib/api-helpers";
import { GameError } from "@/lib/errors";
import {
  assertHost,
  assertPlayer,
  hostSnapshot,
  playerSnapshot,
  requireOnlineCode,
} from "@/lib/online/engine";

export const dynamic = "force-dynamic";

/**
 * 輪詢端點。主持人拿整場狀態；玩家只拿自己看得到的線索與劇本段落。
 * 玩家帶上 ?rev= 且沒有變化時只回 unchanged，省下重送整包內容。
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code } = requireOnlineCode((await ctx.params).code);

    const pin = hostPin(req);
    if (pin) {
      await assertHost(code, pin);
      return jsonOk({ host: await hostSnapshot(code) });
    }

    const roleId = req.headers.get("x-role-id") ?? "";
    const token = req.headers.get("x-player-token") ?? "";
    if (!roleId) throw new GameError("UNAUTHORIZED", "需要主持密碼或玩家身分");
    const session = await assertPlayer(code, roleId, token);

    const known = Number(new URL(req.url).searchParams.get("rev"));
    if (known && known === session.rev) {
      // 仍要記錄在線，主持台才看得到誰還連著
      await playerSnapshot(code, roleId).catch(() => null);
      return jsonOk({ unchanged: true, rev: session.rev });
    }
    return jsonOk({ player: await playerSnapshot(code, roleId) });
  });
}
