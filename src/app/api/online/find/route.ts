import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { findByDate } from "@/lib/online/engine";
import { isScriptId } from "@/lib/online/scripts";

export const dynamic = "force-dynamic";

/** 玩家用「日期＋暱稱」進場：對到暱稱就直接拿回身分，對不到就列出那天的場次去選角 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ date?: string; nickname?: string; script?: string | null }>(req);
    const script = body.script && isScriptId(body.script) ? body.script : undefined;
    return jsonOk(await findByDate(body.date ?? "", body.nickname ?? "", script));
  });
}
