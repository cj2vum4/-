import { handle, jsonOk, readJson } from "@/lib/api-helpers";
import { createSession, listSessions } from "@/lib/game";
import { storageMode } from "@/lib/store";

export const dynamic = "force-dynamic";

/** 列出所有場次（主持人參考用，不含密碼） */
export async function GET() {
  return handle(async () => {
    const sessions = await listSessions();
    return jsonOk({ sessions, storage: storageMode() });
  });
}

/**
 * 主持人開場。
 *
 * 只要一組開場密碼——場次代碼由當天日期自動產生（同一天第二場會加序號），
 * 那個代碼同時也是結束後彙整分頁的名稱。
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson<{ password?: string; title?: string }>(req);
    const session = await createSession({
      password: body.password ?? "",
      title: body.title,
    });
    const { password: _hidden, ...safe } = session;
    return jsonOk({ session: safe });
  });
}
