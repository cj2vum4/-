import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  // 九爺的頁面沒有自己的標題，沿用九爺；首頁與線上劇本各自設定
  title: APP_NAME,
  description: "海星劇本殺的線上開本：選劇本、入場、即時收線索。",
  applicationName: "線上劇本",
  // iOS 加到主畫面時的名稱與全螢幕顯示（圖示用 app/apple-icon.png）
  appleWebApp: { capable: true, title: "線上劇本", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#080603",
  width: "device-width",
  initialScale: 1,
  // 手機上輸入框不要自動放大
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
