#!/usr/bin/env python3
"""
批次 OCR 腳本：掃描 JPG/PDF → Claude Vision API → Supabase

安裝依賴：
    pip install anthropic supabase pymupdf pillow tqdm

使用方式：
    python ocr_batch.py --dir "C:/Users/Michael.Huang/Downloads/劇本/疯兔子白又白砍下脑袋飞起来"

環境變數（或複製 .env.example 為 .env）：
    ANTHROPIC_API_KEY=sk-ant-...
    SUPABASE_URL=https://xxxx.supabase.co
    SUPABASE_KEY=eyJ...
"""

import os
import sys
import json
import base64
import argparse
import time
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from PIL import Image
    import io
except ImportError:
    Image = None

try:
    import anthropic
except ImportError:
    print("請先執行: pip install anthropic")
    sys.exit(1)

try:
    from supabase import create_client
except ImportError:
    print("請先執行: pip install supabase")
    sys.exit(1)

try:
    from tqdm import tqdm
except ImportError:
    tqdm = lambda x, **kw: x  # noqa: E731

# ── 設定 ──────────────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL      = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY      = os.environ.get("SUPABASE_KEY", "")

OCR_PROMPT = (
    "請完整轉錄這張圖片中所有可見的文字，保留原始排版（段落、換行）。"
    "如果有標題請保留。不要添加任何解釋或額外內容，只輸出圖片中的文字。"
)

SUPPORTED_IMG  = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
SUPPORTED_PDF  = {".pdf"}
MAX_IMG_BYTES  = 5 * 1024 * 1024   # Claude 單張上限 5 MB
RETRY_LIMIT    = 3
RETRY_DELAY    = 5  # 秒

# ── 工具函式 ──────────────────────────────────────────────────────────────────

def load_env():
    """從 .env 讀取環境變數（如果存在）"""
    env_path = Path(".env")
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def image_to_base64(path: Path) -> tuple[str, str]:
    """回傳 (base64_data, media_type)，必要時縮圖至 5 MB 以下"""
    with open(path, "rb") as f:
        data = f.read()

    media_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    }
    media_type = media_map.get(path.suffix.lower(), "image/jpeg")

    # 若超過上限，嘗試壓縮
    if len(data) > MAX_IMG_BYTES and Image:
        img = Image.open(io.BytesIO(data)).convert("RGB")
        buf = io.BytesIO()
        quality = 85
        while quality >= 40:
            buf.seek(0); buf.truncate()
            img.save(buf, format="JPEG", quality=quality)
            if buf.tell() <= MAX_IMG_BYTES:
                break
            quality -= 15
        else:
            # 縮小尺寸
            w, h = img.size
            img = img.resize((w // 2, h // 2))
            buf.seek(0); buf.truncate()
            img.save(buf, format="JPEG", quality=75)
        data = buf.getvalue()
        media_type = "image/jpeg"

    return base64.standard_b64encode(data).decode(), media_type


def pdf_to_images(path: Path) -> list[tuple[bytes, str]]:
    """將 PDF 每頁轉為 JPEG bytes，回傳 [(bytes, media_type), ...]"""
    if not fitz:
        raise RuntimeError("未安裝 PyMuPDF，請執行: pip install pymupdf")
    doc = fitz.open(str(path))
    results = []
    for page in doc:
        mat = fitz.Matrix(2, 2)          # 2x 解析度
        pix = page.get_pixmap(matrix=mat)
        results.append((pix.tobytes("jpeg"), "image/jpeg"))
    doc.close()
    return results


def ocr_image(client: anthropic.Anthropic, b64: str, media_type: str) -> str:
    """呼叫 Claude Vision API，帶重試"""
    for attempt in range(1, RETRY_LIMIT + 1):
        try:
            msg = client.messages.create(
                model="claude-opus-4-8",   # 使用最新 Opus 以獲得最佳 OCR 精度
                max_tokens=4096,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {"type": "text", "text": OCR_PROMPT},
                    ],
                }],
            )
            return msg.content[0].text.strip()
        except anthropic.RateLimitError:
            if attempt < RETRY_LIMIT:
                print(f"\n  ⚠ Rate limit，等待 {RETRY_DELAY * attempt}s 後重試…")
                time.sleep(RETRY_DELAY * attempt)
            else:
                raise
        except anthropic.APIError as e:
            print(f"\n  ✗ API 錯誤：{e}")
            raise


def upload_records(supabase_client, records: list[dict], table: str = "cards") -> int:
    """批次上傳到 Supabase，回傳成功筆數"""
    if not records:
        return 0
    # 分批以避免 request body 過大
    BATCH = 50
    uploaded = 0
    for i in range(0, len(records), BATCH):
        chunk = records[i:i + BATCH]
        resp = supabase_client.table(table).insert(chunk).execute()
        uploaded += len(resp.data)
    return uploaded


# ── 主流程 ────────────────────────────────────────────────────────────────────

def collect_files(root: Path) -> list[Path]:
    """遞迴收集目錄下所有支援的圖片/PDF"""
    files = []
    for p in sorted(root.rglob("*")):
        if p.suffix.lower() in SUPPORTED_IMG | SUPPORTED_PDF:
            files.append(p)
    return files


def process_directory(root: Path, output_json: Path, script: str, skip_upload: bool = False):
    load_env()

    global ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY
    ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY)
    SUPABASE_URL      = os.environ.get("SUPABASE_URL", SUPABASE_URL)
    SUPABASE_KEY      = os.environ.get("SUPABASE_KEY", SUPABASE_KEY)

    if not ANTHROPIC_API_KEY:
        sys.exit("❌ 請設定環境變數 ANTHROPIC_API_KEY")
    if not skip_upload and (not SUPABASE_URL or not SUPABASE_KEY):
        sys.exit("❌ 請設定環境變數 SUPABASE_URL 和 SUPABASE_KEY（或加上 --no-upload）")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    supabase = None if skip_upload else create_client(SUPABASE_URL, SUPABASE_KEY)

    files = collect_files(root)
    if not files:
        sys.exit(f"❌ 在 {root} 中找不到任何支援的圖片或 PDF 檔案")

    print(f"✓ 找到 {len(files)} 個檔案，開始 OCR…\n")

    records: list[dict] = []

    # 載入已完成的記錄（支援斷點續傳）
    done_keys: set[str] = set()
    if output_json.exists():
        try:
            existing = json.loads(output_json.read_text(encoding="utf-8"))
            for r in existing:
                done_keys.add(f"{r['filename']}::{r.get('page_num', 0)}")
            records.extend(existing)
            print(f"  ↩ 載入 {len(records)} 筆已完成記錄（斷點續傳）\n")
        except Exception:
            pass

    for file_path in tqdm(files, desc="OCR 進度"):
        suffix = file_path.suffix.lower()
        rel_path = file_path.relative_to(root)
        folder = str(rel_path.parent) if rel_path.parent != Path(".") else ""

        if suffix in SUPPORTED_PDF:
            try:
                pages = pdf_to_images(file_path)
            except Exception as e:
                print(f"\n  ✗ 無法轉換 PDF {file_path.name}: {e}")
                continue

            for page_num, (img_bytes, media_type) in enumerate(pages, start=1):
                key = f"{file_path.name}::{page_num}"
                if key in done_keys:
                    continue
                b64 = base64.standard_b64encode(img_bytes).decode()
                try:
                    text = ocr_image(client, b64, media_type)
                    records.append({
                        "script": script,
                        "filename": file_path.name,
                        "folder": folder,
                        "page_num": page_num,
                        "text": text,
                    })
                    done_keys.add(key)
                    # 即時寫入，保護進度
                    output_json.write_text(
                        json.dumps(records, ensure_ascii=False, indent=2),
                        encoding="utf-8"
                    )
                except Exception as e:
                    print(f"\n  ✗ OCR 失敗 {file_path.name} p{page_num}: {e}")

        else:  # 圖片
            key = f"{file_path.name}::0"
            if key in done_keys:
                continue
            try:
                b64, media_type = image_to_base64(file_path)
                text = ocr_image(client, b64, media_type)
                records.append({
                    "script": script,
                    "filename": file_path.name,
                    "folder": folder,
                    "page_num": 0,
                    "text": text,
                })
                done_keys.add(key)
                output_json.write_text(
                    json.dumps(records, ensure_ascii=False, indent=2),
                    encoding="utf-8"
                )
            except Exception as e:
                print(f"\n  ✗ OCR 失敗 {file_path.name}: {e}")

    print(f"\n✓ OCR 完成，共 {len(records)} 筆，已儲存至 {output_json}")

    if not skip_upload and supabase and records:
        print(f"\n⬆ 上傳至 Supabase…")
        try:
            n = upload_records(supabase, records)
            print(f"✓ 上傳完成：{n} 筆")
        except Exception as e:
            print(f"✗ 上傳失敗：{e}")
            print("  JSON 已保留在本地，可稍後手動重傳。")


def main():
    parser = argparse.ArgumentParser(description="批次 OCR + 上傳 Supabase")
    parser.add_argument(
        "--dir", required=True,
        help="掃描圖片/PDF 所在目錄，例如 C:/Users/.../疯兔子白又白砍下脑袋飞起来"
    )
    parser.add_argument(
        "--output", default="ocr_output.json",
        help="輸出 JSON 路徑（預設 ocr_output.json）"
    )
    parser.add_argument(
        "--script", required=True,
        help="劇本識別碼，例如 fengtuz / tiancai（寫入 Supabase 的 script 欄位）"
    )
    parser.add_argument(
        "--no-upload", action="store_true",
        help="只做 OCR 輸出 JSON，不上傳 Supabase"
    )
    args = parser.parse_args()

    root = Path(args.dir)
    if not root.exists():
        sys.exit(f"❌ 目錄不存在：{root}")

    process_directory(root, Path(args.output), script=args.script, skip_upload=args.no_upload)


if __name__ == "__main__":
    main()
