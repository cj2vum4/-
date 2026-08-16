import { handle, jsonOk, requireCode } from "@/lib/api-helpers";
import { findSession } from "@/lib/game";
import { STAGE_MAP } from "@/lib/config";

export const dynamic = "force-dynamic";

/** 玩家輸入場次時的檢查點：找不到就回 404「無此場次」 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const session = await findSession(code);
    const stage = STAGE_MAP[session.stageId];
    return jsonOk({
      session: {
        code: session.code,
        title: session.title,
        status: session.status,
        stageId: session.stageId,
        stageLabel: stage?.label ?? session.stageId,
        allowJoin: stage?.allowJoin ?? false,
      },
    });
  });
}
