import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    /**
     * 建置時只開 1 個 worker。
     *
     * Render 的建置機回報有 47 顆 CPU，Next.js 預設就開 47 個 worker 平行收集頁面資料，
     * 每個都是獨立的 Node 程序，一下子就超過免費方案的 512MB，程序被系統直接砍掉——
     * 部署紀錄停在「Collecting page data using 47 workers」、沒有任何錯誤訊息就是這個症狀。
     * 這個專案頁面很少，1 個 worker 幾秒就跑完。
     */
    cpus: 1,
  },
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
