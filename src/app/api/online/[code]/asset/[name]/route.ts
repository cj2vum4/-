import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api-helpers";
import { authorizeAsset, requireOnlineCode } from "@/lib/online/engine";
import { CONTENT_ROOT } from "@/lib/online/scripts";

export const dynamic = "force-dynamic";

/**
 * 劇本圖片（角色卡、地圖）。檔案放在 content/ 而不是 public/，
 * 所以只能經過這支、驗過「這張圖已經發給你」才拿得到。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ code: string; name: string }> },
) {
  return handle(async () => {
    const params = await ctx.params;
    const { code } = requireOnlineCode(params.code);
    // 只取檔名，任何路徑成分都丟掉，擋掉 ../ 之類的穿越
    const name = basename(decodeURIComponent(params.name));
    const q = new URL(req.url).searchParams;
    const { script } = await authorizeAsset(code, q.get("who") ?? "", q.get("sig") ?? "", name);
    const file = await readFile(join(CONTENT_ROOT, script, "cards", name));
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "content-type": name.endsWith(".png") ? "image/png" : "image/jpeg",
        // 只給這個瀏覽器快取；網址本身帶簽章，不會被共用快取拿去給別人
        "cache-control": "private, max-age=3600",
      },
    });
  });
}
