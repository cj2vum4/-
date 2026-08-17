/**
 * 憑證解析測試：node --experimental-strip-types tests/credentials.test.mjs
 *
 * 各家平台的環境變數欄位對多行 JSON 的處理都不一樣，這支確保常見的貼法都能吃，
 * 而且真的壞掉時會給出人看得懂的錯誤，而不是把值當 base64 解成亂碼。
 */
import { readCredentials, diagnoseCredentials } from "../src/lib/store/credentials.ts";

const SAMPLE = {
  type: "service_account",
  project_id: "demo",
  client_email: "demo@demo.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
};

const CLEAN_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

function withEnv(vars, fn) {
  const saved = {};
  for (const k of CLEAN_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of CLEAN_ENV) {
      delete process.env[k];
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  }
}

let failed = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${label}: ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "斷言失敗");
}

const json = JSON.stringify(SAMPLE);

check("直接貼整包 JSON", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: json }, () => {
    assert(readCredentials().client_email === SAMPLE.client_email);
  }),
);

check("JSON 前後有空白與換行", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: `\n  ${json}  \n` }, () => {
    assert(readCredentials().client_email === SAMPLE.client_email);
  }),
);

check("JSON 被外層引號包住", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: `'${json}'` }, () => {
    assert(readCredentials().client_email === SAMPLE.client_email);
  }),
);

check("JSON 被多做了一層編碼", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(json) }, () => {
    assert(readCredentials().client_email === SAMPLE.client_email);
  }),
);

check("base64 過的 JSON", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: Buffer.from(json).toString("base64") }, () => {
    assert(readCredentials().client_email === SAMPLE.client_email);
  }),
);

check("開頭有 BOM", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: "\ufeff" + json }, () => {
    assert(readCredentials().client_email === SAMPLE.client_email);
  }),
);

check("private_key 的換行被寫成字面上的 \\n", () =>
  withEnv(
    {
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        ...SAMPLE,
        private_key: SAMPLE.private_key.replace(/\n/g, "\\n"),
      }),
    },
    () => {
      assert(readCredentials().private_key.includes("\n"), "應還原成真正的換行");
    },
  ),
);

check("EMAIL + PRIVATE_KEY 兩個變數的寫法", () =>
  withEnv(
    {
      GOOGLE_SERVICE_ACCOUNT_EMAIL: SAMPLE.client_email,
      GOOGLE_PRIVATE_KEY: SAMPLE.private_key.replace(/\n/g, "\\n"),
    },
    () => {
      const c = readCredentials();
      assert(c.client_email === SAMPLE.client_email);
      assert(c.private_key.includes("\n"));
    },
  ),
);

check("貼成檔名時要丟出清楚的錯誤，不是亂碼", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: "my-project-abc123.json" }, () => {
    let threw = false;
    try {
      readCredentials();
    } catch (err) {
      threw = true;
      assert(err.message.includes("無法解析"), `訊息應說明無法解析，實際：${err.message}`);
    }
    assert(threw, "格式錯誤時應該丟出例外");
  }),
);

check("貼成檔案路徑時同樣要有清楚錯誤", () =>
  withEnv(
    { GOOGLE_SERVICE_ACCOUNT_JSON: "C:\\Users\\me\\Downloads\\my-project.json" },
    () => {
      const d = diagnoseCredentials();
      assert(d.ok === false, "應判定為不 ok");
      assert(d.shape && d.shape.includes("長度"), "應提供外觀描述");
    },
  ),
);

check("診斷不會洩漏金鑰內容", () =>
  withEnv({ GOOGLE_SERVICE_ACCOUNT_JSON: json }, () => {
    const d = diagnoseCredentials();
    const dumped = JSON.stringify(d);
    assert(!dumped.includes("BEGIN PRIVATE KEY"), "診斷結果不可含私鑰");
    assert(!dumped.includes("AAAA"), "診斷結果不可含金鑰內容");
    assert(d.clientEmail === SAMPLE.client_email, "但要顯示 client_email 方便核對");
  }),
);

check("什麼都沒設定時回 null", () =>
  withEnv({}, () => {
    assert(readCredentials() === null);
    assert(diagnoseCredentials().source === null);
  }),
);

if (failed > 0) {
  console.error(`\n${failed} 個案例失敗`);
  process.exit(1);
}
console.log("\n憑證解析測試全部通過");
