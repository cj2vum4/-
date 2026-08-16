import { handle, jsonOk, readJson, requireCode } from "@/lib/api-helpers";
import { GameError } from "@/lib/errors";
import { createSession, listSessions } from "@/lib/game";
import { storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 列出所有場次（主持人開場前參考用） */
export async function GET() {
  return handle(async () => {
    const sessions = await listSessions();
    return jsonOk({ sessions, storage: storageMode() });
  });
}

/** 主持人開啟今天的場次 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ date?: string; title?: string; hostPin?: string }>(req);
    const code = requireCode(body.date ?? "");
    const pin = (body.hostPin ?? "").trim();
    if (pin.length < 4) {
      throw new GameError("BAD_REQUEST", "主持通行碼至少 4 個字，之後回到主持台需要用到");
    }
    const session = await createSession({ code, title: body.title, hostPin: pin });
    const { hostPin: _hidden, ...safe } = session;
    return jsonOk({ session: safe });
  });
}
