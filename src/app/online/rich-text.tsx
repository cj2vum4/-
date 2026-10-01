import { splitRich } from "@/lib/online/rich";

/**
 * 劇本段落／手冊內文：文字照原本的換行顯示，[[img:…]] 標記換成圖片（點圖開原圖）。
 * images 是伺服器簽好的網址；沒有網址的圖（理論上不會發生）只顯示圖說。
 */
export function RichText({
  text,
  images,
  className,
}: {
  text: string;
  images?: Record<string, string>;
  className: string;
}) {
  return (
    <>
      {splitRich(text).map((part, i) => {
        if (part.kind === "text") {
          return (
            <p key={i} className={className}>
              {part.text}
            </p>
          );
        }
        const src = images?.[part.name];
        const caption = part.caption ? <figcaption className="mt-1.5 text-xs leading-relaxed text-muted">{part.caption}</figcaption> : null;
        return (
          <figure key={i} className="my-4">
            {src ? (
              <a href={src} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={part.caption || "插圖"} loading="lazy" className="w-full rounded-lg border border-line/60" />
              </a>
            ) : null}
            {caption}
          </figure>
        );
      })}
    </>
  );
}
