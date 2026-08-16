import { handle, jsonOk, requireCode } from "@/lib/api-helpers";
import { getSnapshot } from "@/lib/game";

export const dynamic = "force-dynamic";

/** 前端輪詢這支拿最新狀態；伺服器有快取，玩家再多也不會打爆 Sheets 配額 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const snapshot = await getSnapshot(requireCode(raw));
    return jsonOk(snapshot);
  });
}
