import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { GameError } from "@/lib/errors";
import { createOnlineSession } from "@/lib/online/engine";
import { isScriptId } from "@/lib/online/scripts";

export const dynamic = "force-dynamic";

/** 主持人開一場線上主持。場次代碼是「劇本前綴＋日期」（沒給日期就是今天） */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ script?: string; pin?: string; date?: string }>(req);
    const script = body.script ?? "";
    if (!isScriptId(script)) throw new GameError("BAD_REQUEST", "沒有這個劇本");
    const code = await createOnlineSession(script, body.pin ?? "", body.date);
    return jsonOk({ code });
  });
}
