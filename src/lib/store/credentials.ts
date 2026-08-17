/**
 * 服務帳號憑證的解析與診斷。
 *
 * 各家平台的環境變數欄位對多行 JSON 的處理都不太一樣：有的會連外層引號一起存、
 * 有的會做一次 JSON 編碼、有的貼進去會帶 BOM。這裡把常見情況都試過一輪，
 * 並且在真的無法解析時給出人看得懂的訊息，而不是丟一串亂碼。
 */

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

export type CredentialSource =
  | "GOOGLE_SERVICE_ACCOUNT_JSON"
  | "EMAIL+PRIVATE_KEY"
  | "GOOGLE_APPLICATION_CREDENTIALS";

export interface CredentialDiagnosis {
  source: CredentialSource | null;
  ok: boolean;
  error?: string;
  /** 安全的外觀描述，只有長度與開頭字元，不含金鑰內容 */
  shape?: string;
  clientEmail?: string;
}

function stripBom(value: string): string {
  return value.replace(/^﻿/, "");
}

/** 去掉整段被引號包住的情況（某些平台會把值連引號一起存） */
function stripWrappingQuotes(value: string): string {
  let s = value;
  while (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      s = s.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return s;
}

function looksLikeBase64(value: string): boolean {
  return value.length > 40 && /^[A-Za-z0-9+/\r\n=]+$/.test(value);
}

function asCredentials(parsed: unknown): ServiceAccountCredentials | null {
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.client_email !== "string" || typeof o.private_key !== "string") return null;
  return o as unknown as ServiceAccountCredentials;
}

/**
 * 依序嘗試各種可能的編碼方式，回傳第一個成功解析出的憑證。
 * 全部失敗時回 null，由呼叫端組出診斷訊息。
 */
function parseFlexible(raw: string): ServiceAccountCredentials | null {
  const base = stripBom(raw).trim();
  const candidates: string[] = [base];

  const unquoted = stripWrappingQuotes(base);
  if (unquoted !== base) candidates.push(unquoted);

  // 被多包了一層 JSON 字串的情況："{\"type\":\"service_account\"…}"
  try {
    const once = JSON.parse(base);
    if (typeof once === "string") candidates.push(once);
  } catch {
    /* 不是合法 JSON，往下試其他方式 */
  }

  // 只有在真的長得像 base64 時才嘗試解碼，避免把純文字解成亂碼
  for (const candidate of [base, unquoted]) {
    if (looksLikeBase64(candidate)) {
      try {
        candidates.push(Buffer.from(candidate, "base64").toString("utf8"));
      } catch {
        /* 忽略 */
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const creds = asCredentials(JSON.parse(candidate));
      if (creds) {
        // 有些貼法會讓換行變成字面上的 \n，補正回真正的換行
        if (!creds.private_key.includes("\n") && creds.private_key.includes("\\n")) {
          creds.private_key = creds.private_key.replace(/\\n/g, "\n");
        }
        return creds;
      }
    } catch {
      /* 換下一種 */
    }
  }
  return null;
}

/** 產生不含機密內容的外觀描述，方便隔空除錯 */
function describe(raw: string): string {
  const trimmed = stripBom(raw).trim();
  const head = trimmed.slice(0, 1);
  const kind = trimmed.startsWith("{")
    ? "看起來是 JSON"
    : looksLikeBase64(trimmed)
      ? "看起來是 base64"
      : trimmed.startsWith('"') || trimmed.startsWith("'")
        ? "開頭是引號，可能連引號一起貼進來了"
        : "既不是 JSON 也不是 base64";
  return `長度 ${trimmed.length} 字元，開頭是 ${JSON.stringify(head)}，${kind}`;
}

/**
 * 讀取憑證。回傳 null 代表根本沒設定（呼叫端應退回記憶體模式），
 * 拋出例外代表有設定但格式不對（這種情況要讓使用者知道，不能默默略過）。
 */
export function readCredentials(): ServiceAccountCredentials | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    const creds = parseFlexible(raw);
    if (!creds) {
      throw new Error(
        `GOOGLE_SERVICE_ACCOUNT_JSON 無法解析（${describe(raw)}）。` +
          `請貼上服務帳號 JSON 檔的完整內容，從 { 開頭到 } 結尾。`,
      );
    }
    return creds;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (email && key) {
    return {
      client_email: email.trim(),
      private_key: key.replace(/\\n/g, "\n"),
    };
  }

  // 交給 GOOGLE_APPLICATION_CREDENTIALS / ADC，由 google-auth-library 自己讀檔
  return null;
}

/** 給 /api/health 用：只描述狀態，永遠不拋出例外 */
export function diagnoseCredentials(): CredentialDiagnosis {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    try {
      const creds = parseFlexible(raw);
      if (!creds) {
        return {
          source: "GOOGLE_SERVICE_ACCOUNT_JSON",
          ok: false,
          error: "無法解析成服務帳號 JSON，請確認貼上的是檔案完整內容（從 { 到 }）",
          shape: describe(raw),
        };
      }
      return {
        source: "GOOGLE_SERVICE_ACCOUNT_JSON",
        ok: true,
        clientEmail: creds.client_email,
      };
    } catch (err) {
      return {
        source: "GOOGLE_SERVICE_ACCOUNT_JSON",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        shape: describe(raw),
      };
    }
  }

  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    const key = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
    const looksRight = key.includes("BEGIN") && key.includes("PRIVATE KEY");
    return {
      source: "EMAIL+PRIVATE_KEY",
      ok: looksRight,
      error: looksRight ? undefined : "GOOGLE_PRIVATE_KEY 看起來不是完整的私鑰",
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { source: "GOOGLE_APPLICATION_CREDENTIALS", ok: true };
  }

  return { source: null, ok: false, error: "未設定任何服務帳號憑證" };
}
