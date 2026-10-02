import { redirect } from "next/navigation";

/** 舊的線上主持入口：劇本改在首頁選，主持人走首頁的秘密入口 */
export default function OnlineHub() {
  redirect("/");
}
