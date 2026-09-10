"use client";

import { useState } from "react";

/**
 * 角色海報。
 *
 * 圖片放在外部圖床，連不到時（圖床掛掉、玩家網路擋掉、連結失效）
 * 直接不顯示，而不是留一個破圖框在畫面上。
 */
export function CharacterPoster({
  src,
  alt,
  className = "",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
