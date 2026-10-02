import type { MetadataRoute } from "next";

/** 安裝成 App（加到主畫面）時的名稱「線上劇本」與圖示：海星劇本殺的金色鑰匙孔海星 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "線上劇本",
    short_name: "線上劇本",
    description: "海星劇本殺的線上開本：選劇本、入場、即時收線索。",
    lang: "zh-TW",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#080603",
    theme_color: "#080603",
    categories: ["entertainment", "games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
