import { handle, jsonOk, requireCode } from "@/lib/api-helpers";
import { CHARACTERS } from "@/lib/characters";
import { STAGE_MAP } from "@/lib/config";
import { availableCharacters, getSessionMeta } from "@/lib/game";

export const dynamic = "force-dynamic";

/**
 * 玩家輸入場次時的檢查點：找不到就回 404「無此場次」。
 * 同時回傳還沒被選走的角色，讓入場畫面可以直接列出可選名單。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const { code: raw } = await ctx.params;
    const code = requireCode(raw);
    // 這裡用 getSessionMeta 而不是 findSession：封存的場次也要回得了內容，
    // 玩家端才知道要顯示「回顧」而不是一片空白
    const session = await getSessionMeta(code);
    const ended = session.archived || session.status === "closed";
    const stage = STAGE_MAP[session.stageId];
    // 已封存的場次沒有玩家名單可查，選角資訊也用不到了
    const available = ended ? new Set<string>() : new Set(await availableCharacters(code));

    return jsonOk({
      session: {
        code: session.code,
        title: session.title,
        status: session.status,
        stageId: session.stageId,
        stageLabel: stage?.label ?? session.stageId,
        allowJoin: ended ? false : (stage?.allowJoin ?? false),
        archived: ended,
      },
      // 揭露劇本的公開角色設定供選角參考，但不含真實陣營等機密
      characters: CHARACTERS.map((c) => ({
        id: c.id,
        name: c.name,
        difficulty: c.difficulty,
        gender: c.gender,
        age: c.age,
        occupation: c.occupation,
        personality: c.personality,
        appearance: c.appearance,
        note: c.note ?? null,
        poster: c.poster ?? null,
        taken: !available.has(c.id),
      })),
    });
  });
}
