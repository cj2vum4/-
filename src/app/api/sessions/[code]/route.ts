import { handle, jsonOk, requireCode } from "@/lib/api-helpers";
import { CHARACTERS } from "@/lib/characters";
import { STAGE_MAP } from "@/lib/config";
import { availableCharacters, findSession } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 玩家輸入場次時的檢查點：找不到就回 404「無此場次」。
 * 同時回傳還沒被選走的角色，讓入場畫面可以直接列出可選名單。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    const session = await findSession(code);
    const stage = STAGE_MAP[session.stageId];
    const available = new Set(await availableCharacters(code));

    return jsonOk({
      session: {
        code: session.code,
        title: session.title,
        status: session.status,
        stageId: session.stageId,
        stageLabel: stage?.label ?? session.stageId,
        allowJoin: stage?.allowJoin ?? false,
      },
      // 只揭露角色名稱與難度，不含陣營等機密設定
      characters: CHARACTERS.map((c) => ({
        id: c.id,
        name: c.name,
        difficulty: c.difficulty,
        taken: !available.has(c.id),
      })),
    });
  });
}
