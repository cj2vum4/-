import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { GameError } from "@/lib/errors";
import { createOnlineSession } from "@/lib/online/engine";
import { isScriptId } from "@/lib/online/scripts";

export const dynamic = "force-dynamic";

/** 主持人開一場線上主持。回傳系統產生的場次代碼 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ script?: string; pin?: string }>(req);
    const script = body.script ?? "";
    if (!isScriptId(script)) throw new GameError("BAD_REQUEST", "沒有這個劇本");
    const code = await createOnlineSession(script, body.pin ?? "");
    return jsonOk({ code });
  });
}
