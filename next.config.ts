import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    /**
     * 型別檢查改成建置流程中的獨立一步（見 package.json 的 build 指令）。
     *
     * 原因：`next build` 內建的型別檢查會在已經佔用大量記憶體的狀態下才啟動，
     * 兩者疊加後峰值超過 550MB，在 Render 免費方案（512MB）會 OOM。
     * 拆開跑之後峰值變成兩者取大，而不是相加。
     *
     * 型別檢查沒有被跳過 —— build 指令會先跑 tsc，有錯一樣會中斷建置。
     */
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
