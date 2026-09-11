import { handle, jsonOk, playerAuth, requireCode } from "@/lib/api-helpers";
import { GameError } from "@/lib/errors";
import { assertPlayer, getSessionMeta } from "@/lib/game";
import { STORY, STORY_EPILOGUE, STORY_SUBTITLE, STORY_TITLE } from "@/lib/story";

export const dynamic = "force-dynamic";

/**
 * 故事復盤。
 *
 * 這份東西把全場陣營與所有真相攤開，所以：
 *   1. 只給已入場的玩家（要通行碼）
 *   2. 只在聘書發放後才給——那是遊戲結束的訊號
 *
 * 內容刻意不放進前端 bundle，否則開場前就能在 devtools 看完結局。
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const { playerId, joinCode } = playerAuth(req);
    await assertPlayer(code, playerId, joinCode);

    const session = await getSessionMeta(code);
    if (!session.certsIssued) {
      throw new GameError("BAD_REQUEST", "故事復盤要等主持人發放聘書之後才會公開");
    }

    return jsonOk({
      title: STORY_TITLE,
      subtitle: STORY_SUBTITLE,
      chapters: STORY,
      epilogue: STORY_EPILOGUE,
    });
  });
}
