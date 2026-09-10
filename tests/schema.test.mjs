/**
 * 欄位配置相容性測試：node --experimental-strip-types tests/schema.test.mjs
 *
 * 這支存在的原因：場次總表的欄位改過兩次，每次都讓改版前建立的場次
 * 讀到錯位的主持通行碼，主持人因此進不去自己的場次。
 * 新增欄位時務必回來補一個案例，並提供 scripts/migrate-sessions.mjs 的遷移路徑。
 */
import { rowToSession, rowToPlayer, sessionToRow, playerToRow } from "../src/lib/store/driver.ts";

let failed = 0;

/** 逐鍵比對，不受物件鍵的排列順序影響 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function check(label, actual, expected) {
  if (deepEqual(actual, expected)) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failed++;
  console.error(`  FAIL  ${label}\n        實際 ${JSON.stringify(actual)}\n        預期 ${JSON.stringify(expected)}`);
}

// ---- 舊格式（8 欄，沒有彩池欄位）----
const legacyRow = [
  "2026-09-09",
  "2026-09-09 場次",
  "open",
  "week1",
  "否",
  "0909",                      // 主持通行碼在第 6 欄
  "2026-09-09T12:09:03.000Z",  // 建立時間
  "2026-09-09T13:36:37.000Z",  // 更新時間
];
const legacy = rowToSession(legacyRow);
check("舊格式：主持通行碼", legacy.hostPin, "0909");
check("舊格式：建立時間", legacy.createdAt, "2026-09-09T12:09:03.000Z");
check("舊格式：更新時間", legacy.updatedAt, "2026-09-09T13:36:37.000Z");
check("舊格式：彩池為空", legacy.pool, []);
check("舊格式：階段", legacy.stageId, "week1");

// ---- 新格式（10 欄）----
const currentRow = [
  "2030-01-01",
  "測試場",
  "open",
  "week2",
  "是",
  "week2",
  "P:99,S:w2_steal_power",
  "1234",
  "2030-01-01T00:00:00.000Z",
  "2030-01-01T01:00:00.000Z",
];
const current = rowToSession(currentRow);
check("新格式：主持通行碼", current.hostPin, "1234");
check("新格式：彩池階段", current.poolStage, "week2");
check("新格式：彩池內容", current.pool, ["P:99", "S:w2_steal_power"]);
check("新格式：建立時間", current.createdAt, "2030-01-01T00:00:00.000Z");

// ---- 空彩池的新格式，不可被誤判成舊格式 ----
const emptyPoolRow = [
  "2030-02-02", "空池場", "open", "casting", "否", "", "", "5678",
  "2030-02-02T00:00:00.000Z", "2030-02-02T00:00:00.000Z",
];
check("新格式且彩池為空：主持通行碼", rowToSession(emptyPoolRow).hostPin, "5678");

// ---- 來回轉換必須一致 ----
check("場次來回轉換", rowToSession(sessionToRow(current)), current);

const player = {
  id: "PABC123", characterId: "zhouqian", name: "周謙", joinCode: "0001",
  faction: "九爺", hiddenBranch: "", hiddenBranchLocked: false,
  power: 300, prestige: 9, hp: 0, drawsRemaining: 3,
  heldCards: ["w2_steal_power", "w2_gift_prestige"],
  status: "active", joinedAt: "2030-01-01T00:00:00.000Z", updatedAt: "2030-01-01T00:00:00.000Z",
  nickname: "阿謙", certRank: 1,
};
check("玩家來回轉換", rowToPlayer(playerToRow(player)), player);

// ---- 暱稱與聘書名次是後來追加在最後面的欄位，舊列讀起來必須是空值而不是壞掉 ----
const legacyPlayerRow = playerToRow(player).slice(0, 15);
const legacyPlayer = rowToPlayer(legacyPlayerRow);
check("舊玩家列：暱稱為空", legacyPlayer.nickname, "");
check("舊玩家列：聘書名次為 0", legacyPlayer.certRank, 0);
check("舊玩家列：其餘欄位不受影響", legacyPlayer.heldCards, player.heldCards);
check("舊玩家列：勢力值不受影響", legacyPlayer.power, 300);

const noCards = { ...player, heldCards: [] };
check("玩家沒有技能卡時不會變成 ['']", rowToPlayer(playerToRow(noCards)).heldCards, []);

if (failed > 0) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log("\n欄位配置相容性測試全部通過");
