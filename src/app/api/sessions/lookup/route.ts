import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { findByPassword } from "@/lib/game";
import { STAGE_MAP } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * 用開場密碼找場次。主持人與玩家共用這個入口。
 *
 * 只認還開著的場次；找不到就是「無此場次」。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ password?: string }>(req);
    const session = await findByPassword(body.password ?? "");
    const stage = STAGE_MAP[session.stageId];
    return jsonOk({
      session: {
        code: session.code,
        title: session.title,
        status: session.status,
        stageId: session.stageId,
        stageLabel: stage?.label ?? session.stageId,
        allowJoin: stage?.allowJoin ?? false,
        // 已結束的場次只能回顧，不能再進場
        archived: session.archived || session.status === "closed",
      },
    });
  });
}
