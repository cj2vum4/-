/**
 * 劇本與手冊內文的圖片標記：單獨一行（段）寫 [[img:檔名|圖說]]，網站就顯示成圖片。
 *
 * 伺服器用 imageNames() 找出內文用到哪些圖、替每張圖簽好網址；
 * 前端用 splitRich() 把內文切成「文字」與「圖片」兩種片段。
 * 這個檔前後端都會 import，只能放解析規則，不能放任何劇本內容。
 */

const IMG_LINE = /^\[\[img:([^|\]]+)(?:\|([^\]]*))?\]\]$/;

export type RichPart = { kind: "text"; text: string } | { kind: "img"; name: string; caption: string };

export function splitRich(text: string): RichPart[] {
  const parts: RichPart[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").replace(/^\n+|\n+$/g, "");
    if (t) parts.push({ kind: "text", text: t });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const m = IMG_LINE.exec(line.trim());
    if (m) {
      flush();
      parts.push({ kind: "img", name: m[1], caption: m[2] ?? "" });
    } else {
      buf.push(line);
    }
  }
  flush();
  return parts;
}

export function imageNames(text: string): string[] {
  return splitRich(text).flatMap((p) => (p.kind === "img" ? [p.name] : []));
}
