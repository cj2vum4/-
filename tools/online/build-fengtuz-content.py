#!/usr/bin/env python3
"""
把瘋兔子的原始檔整理成線上主持用的內容。

    pip install pymupdf pillow
    python tools/online/build-fengtuz-content.py

讀取：
    content/online/fengtuz/raw/scripts/*·列印版.docx   6 本人物劇本＋DM 手冊（繁體整理版）
    content/online/fengtuz/raw/clues/*.pdf              線索卡掃描檔（每頁一張卡）
      ↑ 這兩個資料夾上傳整理完就從 repo 移除，要重建時請重新放回
    content/online/fengtuz/raw/extra/                   臺詞卡、劇本插圖、手冊板書、角色海報（留在 repo）
    tools/online/fengtuz_fixes.py                        人工校對表（OCR 錯字、漏行、原手冊誤植）

產出：
    content/online/fengtuz/docs.json      每個角色依幕切好的劇本（含插圖標記）
    content/online/fengtuz/cards.json     27 張線索卡（文字取自 DM 手冊）
    content/online/fengtuz/cards/*.jpg    線索卡圖片（01–21 掃描、22–27 臺詞卡）
    content/online/fengtuz/handbook.json  DM 手冊依階段切段（含板書圖標記），放在主持台「手冊」分頁
    content/online/fengtuz/images/*.jpg   劇本插圖、手冊板書
    content/online/fengtuz/posters/*.jpg  角色海報（選角畫面用）

圖片標記：劇本與手冊內文裡單獨一段的 [[img:檔名|圖說]]，網站會顯示成圖片。

另外會寫一份 raw/build-review.txt：列出這次合併了哪些斷行、改了哪些引號，方便人工核對。
"""
import html
import json
import re
import shutil
import zipfile
from pathlib import Path

from fengtuz_fixes import DOC_FIXES, HANDBOOK_FIXES

ROOT = Path(__file__).resolve().parents[2] / "content" / "online" / "fengtuz"
RAW = ROOT / "raw"
EXTRA = RAW / "extra"

ROLES = {
    "xia-tong": "夏瞳",
    "jian-feifei": "簡菲菲",
    "jiang-qin": "姜沁",
    "jian-ci": "簡辭",
    "lin-yunshu": "林雲書",
    "wang-zhiyu": "王之喻",
}
NUM = "一二三四五六七"
ACT_TITLES = ["瘋兔子", "三具屍體", "恐怖遊輪", "儀式失敗", "殺與被殺", "白日飛昇", "這個故事裡沒有愛，只有爛透的柔情"]

review: list[str] = []


def paragraphs(path: Path) -> list[str]:
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf8")
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        t = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p))
        out.append(html.unescape(t).strip())
    return [t for t in out if t]


# ---------------- 校對表 ----------------


class Fixes:
    """套用校對表並記錄每筆實際命中幾次，最後一次核對"""

    def __init__(self, label: str, fixes):
        self.label = label
        self.fixes = fixes
        self.hits = [0] * len(fixes)

    def apply(self, text: str, match=lambda fix: True) -> str:
        for i, fix in enumerate(self.fixes):
            if not match(fix):
                continue
            old, new = fix[-3], fix[-2]
            n = text.count(old)
            if n:
                text = text.replace(old, new)
                self.hits[i] += n
        return text

    def check(self):
        bad = [(f, h) for f, h in zip(self.fixes, self.hits) if h != f[-1]]
        if bad:
            lines = "\n".join(f"  預期 {f[-1]} 次、實際 {h} 次：{f[:-3]} {f[-3]!r}" for f, h in bad)
            raise SystemExit(f"{self.label}校對表有 {len(bad)} 筆對不上（原文件改版了？）：\n{lines}")


# ---------------- 劇本文字清理 ----------------

# 書眉 logo「瘋兔子白又白砍下腦袋飛起來／THE CRAZY MEAT」被 OCR 讀成的殘渣
HEADER_NOISE = re.compile(r"(?:瘋起來)?[A-Z]{0,4}CRA[ZL]YMEA[TD]|瘋起來")
# 刪節號被 OCR 讀成 ·. .· ．. ·· 之類
DOT_NOISE = re.compile(r"[·．.]*[·．][·．.]*")
# 句末（包含引號、括號、刪節號、破折號結尾）
END = re.compile(r"[。！？!?…“”‘’\"'」』）)：:～~—\]]$")
# 台詞開頭「某某：」、段落標號、小標
SPEAKER = re.compile(r"^[一-鿿]{1,6}[：:]")
HEADING = re.compile(r"^(?:[（(][一二三四五六七八九十\d]+[）)]|\d+[、.]|個人任務|小劇場|\[\[img:)")
# 小劇場裡接在台詞後面、但不是台詞續行的旁白與指示（六本就這幾種）
NARRATION = re.compile(r"^(?:聊到這時|其他人小劇場|請根據臺詞卡|聚肉無骨|血肉苦楚|恭喜您|[（(])")


def clean_noise(body: str) -> str:
    out = []
    for p in body.split("\n\n"):
        q = HEADER_NOISE.sub("", p)
        # 只有「因為拿掉雜訊而變成只剩標點」的段落才丟掉；原本就是「……」的分隔段要留著
        if q != p and re.fullmatch(r"[…。，、\s]*", q):
            continue
        out.append(DOT_NOISE.sub("……", q).strip())
    return "\n\n".join(p for p in out if p)


def unclosed(p: str) -> bool:
    return p.count("“") > p.count("”")


def merge_broken(where: str, body: str, scene: bool) -> str:
    """
    原 OCR 一行一段：句子沒結束就換段的，接回下一段。
    小劇場另外把同一句台詞折到下一行的部分接回來（引號還沒收、下一段不是新的台詞或新的引號）。
    """
    out: list[str] = []
    for p in body.split("\n\n"):
        prev = out[-1] if out else ""
        wrapped = prev and not END.search(prev) and not HEADING.match(p) and not SPEAKER.match(p) and not HEADING.match(prev)
        continued = (
            scene and prev and SPEAKER.match(prev) and unclosed(prev)
            and not HEADING.match(p) and not SPEAKER.match(p) and not NARRATION.match(p) and not p.startswith(("“", "‘"))
        )
        if wrapped or continued:
            review.append(f"[合併] {where}：「…{prev[-14:]}」＋「{p[:14]}…」")
            out[-1] = prev + p
        else:
            out.append(p)
    return "\n\n".join(out)


# 中文後面的半形標點
HALF_PUNCT = re.compile(r"(?<=[一-鿿…”’」）])([,?!:;])")
FULL = {",": "，", "?": "？", "!": "！", ":": "：", ";": "；"}
QUOTES = re.compile(r"[^“”‘’\"']")


def fix_quotes(where: str, body: str, scene: bool) -> str:
    """統一標點：中文後的半形標點、半形與方向錯的引號改成全形；小劇場每一句台詞補上收尾引號"""
    out = []
    for p in body.split("\n\n"):
        q = HALF_PUNCT.sub(lambda m: FULL[m.group(1)], p)
        # 段首用單引號開頭、整段沒有對應的收尾 → 其實是雙引號
        if q.startswith("‘") and "’" not in q:
            q = "“" + q[1:]
        # 逐字看引號：半形雙引號依目前是否有未閉合的「“」決定方向；
        # 單引號若緊接在「”」後面是新的一句（“），緊接在句末標點後面且有未閉合的「“」是收尾（”），
        # 其他（例如「‘互助會’」）是真的單引號，保留
        chars, depth, single = [], 0, False
        for ch in q:
            prev = chars[-1] if chars else ""
            if ch == "“":
                depth += 1
            elif ch == "”":
                depth = max(0, depth - 1)
            elif ch == '"':
                ch = "”" if depth > 0 else "“"
                depth = depth - 1 if ch == "”" else depth + 1
            elif ch in "‘’'" and not single:
                if prev == "”":
                    ch, depth = "“", depth + 1
                elif depth > 0 and prev in "。！？!?…～~":
                    ch, depth = "”", depth - 1
                elif ch == "‘":
                    single = True
            elif ch in "’'" and single:
                single = False
            chars.append(ch)
        q = "".join(chars)
        opened = q.count("“") > q.count("”")
        # 句末的 ‘ ’ ' “ 其實是收尾的 ”
        if opened and re.search(r"[‘’'“]$", q):
            q = q[:-1] + "”"
            opened = q.count("“") > q.count("”")
        # 小劇場一句一段，台詞沒收尾就補上
        if scene and opened and SPEAKER.match(q) and re.search(r"[。！？!?…～~]$", q):
            q += "”"
        # 只把引號有變動的列入人工核對（半形標點改全形不列）
        if QUOTES.sub("", q) != QUOTES.sub("", p):
            review.append(f"[引號] {where}：「{p[-18:]}」→「{q[-18:]}」")
        out.append(q)
    return "\n\n".join(out)


# 第七幕（一）～（五）的小標：OCR 常把這種短行漏掉或半形全形混用，統一重放在各段第一句前面
ACT7_PARTS = [
    ("（一）", None),
    ("（二）", "淅瀝瀝的雨夜"),
    ("（三）", "那是一間孩子的臥室"),
    ("（四）", "那是一條狹窄的巷子"),
    ("（五）", "巷子裡的積水倒映出女生的模樣，是夏瞳"),
]


def act7_headings(where: str, body: str) -> str:
    body = "\n\n".join(p for p in body.split("\n\n") if not re.fullmatch(r"[（(][一二三四五][）)]", p))
    for heading, anchor in ACT7_PARTS:
        body = insert_after(where, body, "\n\n", anchor, heading, before=True)
    return body


# ---------------- 劇本插圖（六本共用，AUDIT 🟡1） ----------------

# (段落 id, 插在哪一段之後（None＝最前面）, 圖檔, 來源)
DOC_IMAGES = [
    ("act6", None, "act6-1.jpg", "插圖1_"),
    ("act6", "將整片夜空染成了玫瑰色。", "act6-2.jpg", "插圖2_"),
    ("act6", "而是藍色的地球。", "act6-3.jpg", "插圖3_"),
    ("act7", "眼中只剩下了那個咀嚼肉瘤的身影。", "act7-1.jpg", "插圖4_"),
    ("act7", "一長串轉身離去的高跟鞋聲。", "act7-2.jpg", "插圖5_"),
    ("act7", "因刀刃而翻卷的皮肉。", "act7-3.jpg", "插圖6_"),
    ("act7", "嘴角也溢出了白沫。", "act7-4.jpg", "插圖7_"),
    ("act7", "一次次呼喚親人的名字。", "act7-5.jpg", "插圖8_"),
]


def insert_after(where: str, text: str, sep: str, anchor: str | None, marker: str, before=False) -> str:
    parts = text.split(sep)
    if anchor is None:
        return sep.join([marker, *parts])
    idx = [i for i, p in enumerate(parts) if anchor in p]
    if len(idx) != 1:
        raise SystemExit(f"{where}：插圖錨點「{anchor}」找到 {len(idx)} 處，應該剛好 1 處")
    i = idx[0] if before else idx[0] + 1
    return sep.join([*parts[:i], marker, *parts[i:]])


# ---------------- 人物劇本 ----------------


def slogans(hb):
    """手冊「分發角色」那段：夏瞳（女）：我會把女兒，一寸一寸的救回來。"""
    out = {}
    for t in hb:
        m = re.match(r"^(\S+?)（[男女]）：(.+)$", t)
        if m and m.group(1) in ROLES.values():
            out[m.group(1)] = m.group(2)
    return out


# 紙本翻頁提示，線上改由主持人開放，不需要顯示
NOISE = re.compile(r"未經主持人允許|——\s*請勿翻開下一頁\s*——")


def build_docs(slogan):
    fixes = Fixes("人物劇本", DOC_FIXES)
    docs = {}
    for role_id, name in ROLES.items():
        lines = paragraphs(RAW / "scripts" / f"{name}·列印版.docx")
        start = lines.index("第一幕")
        # 劇本封面的 slogan 是掃描 OCR，會混進雜字；改用 DM 手冊分角時的版本
        hint = slogan[name]

        sections, cur, act, scenes = [], None, 0, 0
        for t in lines[start:]:
            m_act = re.fullmatch(r"第([一二三四五六七])幕", t)
            m_scene = re.fullmatch(r"小劇場\s*(\d?)", t)
            if m_act:
                act = NUM.index(m_act.group(1)) + 1
                cur = {"id": f"act{act}", "title": f"第{m_act.group(1)}幕", "unlockAny": [f"FT-ACT{act}"], "lines": [], "needSubtitle": True}
                sections.append(cur)
                continue
            if m_scene:
                n = m_scene.group(1)
                if n:
                    key, title = f"FT-S7-{n}", f"第七幕 · 小劇場 {n}"
                else:
                    scenes += 1
                    # 第一幕的小劇場；王之喻多一段驗牌時的專屬小劇場
                    key = "FT-SCENE1" if scenes == 1 else "FT-SCENE1-WANG"
                    title = "第一幕 · 小劇場" if scenes == 1 else "第一幕 · 驗牌小劇場"
                cur = {"id": key.lower(), "title": title, "unlockAny": [key], "lines": []}
                sections.append(cur)
                continue
            if cur is None:
                continue
            if cur.pop("needSubtitle", False):
                sub = ACT_TITLES[act - 1]
                # 第七幕的副標與內文在原檔黏在同一行（OCR 還有錯字），用前綴切開
                m = re.match(r"^這個故事裡沒有愛，只有爛透的.情", t)
                if act == 7 and m:
                    cur["title"] += f" · {sub}"
                    t = t[m.end():]
                elif t == sub or t.replace(" ", "") == sub:
                    cur["title"] += f" · {sub}"
                    continue
            t = NOISE.sub("", t).strip()
            # 書眉「瘋兔子白又白砍下腦袋飛起來」被 OCR 切碎後殘留的短字
            if re.fullmatch(r"(瘋起來|砍腦袋\S{0,4}|\S{0,3}飛起來)", t):
                continue
            # 結尾兩段在原檔黏在一起
            t = t.replace("完成你的小劇場聚肉無骨", "完成你的小劇場。\n\n聚肉無骨")
            if t:
                cur["lines"].append(t)

        out = []
        for s in sections:
            where = f"{name}/{s['id']}"
            body = "\n\n".join(s["lines"])
            body = fixes.apply(body, lambda f, r=role_id, sid=s["id"]: f[0] in ("*", r) and f[1] == sid)
            scene = s["id"].startswith("ft-")
            body = clean_noise(body)
            body = merge_broken(where, body, scene)
            # 小劇場開頭兩行指示接起來後補上逗號：「請你狠狠地嘲諷林雲書，然後聽聽…」
            body = re.sub(r"(嘲諷[^，,\n]+?)(然後聽聽)", r"\1，\2", body)
            body = fix_quotes(where, body, scene)
            if s["id"] == "act7":
                body = act7_headings(where, body)
            for sid, anchor, img, _ in DOC_IMAGES:
                if sid == s["id"]:
                    body = insert_after(where, body, "\n\n", anchor, f"[[img:{img}]]")
            out.append({"id": s["id"], "book": "人物劇本", "title": s["title"], "unlockAny": s["unlockAny"], "body": body})
        docs[role_id] = {"hint": hint, "list": out}
        print(f"  {name}：{len(sections)} 段，slogan「{hint}」")
    fixes.check()
    return docs


# ---------------- DM 手冊 ----------------


def handbook_lines():
    """手冊逐行；先把整本套上校對表（線索卡文字也從這裡取）"""
    fixes = Fixes("DM 手冊", HANDBOOK_FIXES)
    text = fixes.apply("\n".join(paragraphs(RAW / "scripts" / "《瘋兔子》手冊·列印版.docx")))
    fixes.check()
    return text.split("\n")


def between(lines, start, end):
    """取 start 那一行之後、end 那一行之前的內容（都用完全比對）"""
    i = lines.index(start)
    j = lines.index(end, i + 1) if end else len(lines)
    return "\n".join(lines[i + 1 : j])


# 第一幕卡牌遊戲的撲克牌（線上版取代實體撲克牌與毒牌標記）
POKER_BODY = "一副標準撲克牌，去掉 J／Q／K／王，只留 A–10 共 40 張。\n\n驗牌時整副牌都翻開給大家看，覺得有問題可以洗牌；陸江遠開始發牌後就看不到牌面了。\n\n輪到你上桌和陸江遠對賭時，在這裡抽牌或停止。"
POKER_NOTE = (
    "第一幕 Step4 和卡牌遊戲規則 03 一起發給全體。展開這張卡就是牌桌控制：\n"
    "① 驗牌：玩家打開就看得到整副牌、可以洗牌（王之喻第一個驗），誰洗了牌會依序記在牌桌紀錄。\n"
    "② 大家驗完，你在面前再洗一次，按「開始發牌」——牌面蓋起來，玩家不能再洗。\n"
    "③ 依驗牌相反的順序選玩家「開一局」：各發一張起始牌（玩家只看得到自己的），玩家在手機上抽牌／停止，"
    "你幫陸江遠抽牌／停止，最後「翻牌比點」、「收進棄牌堆」。王之喻不上桌。\n"
    "④ 王之喻唸驗牌小劇場時，在新牌堆點一張牌「貼毒牌標記」——牌局作廢，玩家端改成公開棄牌堆與新牌堆（毒牌會標出來），接 Step7 牌局兇案。"
)

# 第四幕恐搜：手冊沒寫、`第四幕·双搜.docx` 才有的 DM 須知（AUDIT 🟡8）
SEARCH_NOTE = "下毒動作太明顯可以上前質疑，別讓他們太輕易得手；不需要 DM 死在玩家面前，讓玩家知道他們最終一定得手即可。"


def build_cards(hb):
    def after(marker, n):
        i = next(k for k, t in enumerate(hb) if marker in t)
        return "\n".join(hb[i + 1 : i + 1 + n])

    task_intro = after("（第一輪蒐證）", 6)
    cards = [
        # id, 標題, 分組, 對象, 內文, 圖片, 主持筆記
        ("01", "故事背景", "開場", "all", after("【背景故事】01", 14).replace("【背景故事】\n", ""), ["01.jpg"], ""),
        ("02", "破冰遊戲", "開場", "pick", "遊戲題目：\n\n戴上頭套，從椅子上飛下來。", [], "發給扮演「普通人」的五位玩家，不發給扮演瘋兔子的那位。"),
        ("03", "卡牌遊戲規則", "第一幕", "all", after("①發放線索【卡牌遊戲規則】03", 9).replace("卡牌遊戲規則\n", ""), ["03.jpg"], ""),
        # 線上版的實體道具：一副撲克牌（打開是互動牌桌，見 src/app/online/poker.tsx）
        ("poker", "撲克牌（陸江遠的賭局）", "第一幕", "all", POKER_BODY, [], POKER_NOTE),
        ("04", "卡牌案線索·袖裡的魚線", "第一幕", "all", "陸江遠的袖子裡，有一根魚線，魚線後面還沾了些透明膠。可完成「袖裡乾坤」換牌手法。", ["04.jpg"], "表明陸江遠出千成性，這次賭局也帶了出千工具（袖裡換牌）。"),
        ("05", "卡牌案線索·辭退信", "第一幕", "all", "一封辭退信——陸江遠作為荷官，在與遊客賭牌時出千，因未對公司造成損失，故僅作辭退處理。", ["05.jpg"], "同時發放棄牌堆、新牌堆（貼毒牌標記）與小塑膠瓶。"),
        ("06", "觸發線索·遊輪佈局", "第二幕", "all", "廖向冬回憶：\n（關鍵詞：遊輪佈局）\n\n我記得第一具屍體是在船尾甲板，而且遊輪佈局沒什麼特別的，一樓甲板，二樓客房，三樓駕駛室。", ["06.jpg"], "觸發式：玩家提到關鍵詞再發；卡住也可直接發。強調屍體在船尾，船尾有船錨，操控船錨的駕駛室在三樓。"),
        ("07", "觸發線索·新風系統", "第二幕", "all", "廖向冬回憶：\n（關鍵詞：新風系統）\n\n事後我又去了一趟駕駛室，我當時也懷疑新風系統出了什麼問題，它就在每間房靠近房門的牆壁上。但新風系統是好的，單向和雙向運行都正常。", ["07.jpg"], "觸發式。房內新風系統可單向排風，導致死者窒息、廖向冬打不開門；系統是好的，代表死者可以自己關掉排風。"),
        ("08", "觸發線索·門牌號", "第二幕", "all", "廖向冬回憶：\n（關鍵詞：門牌號）\n\n可能吧，但我不確定。因為我幾乎沒怎麼去過客房部，而且又有兩個人被殺了，加上我感覺我頭上的肉瘤開始吞噬我的理智了，沒注意到也是正常。", ["08.jpg"], "觸發式。強調廖向冬已經沒什麼理智了（調換門牌詭計）。"),
        ("09", "飛昇儀式", "第三幕", "all", after("①發放線索【飛昇儀式】09", 12).replace("飛昇儀式\n", "", 1), ["09.jpg"], ""),
        ("10-11", "蒐證任務卡一（夏瞳＆林雲書）", "第四幕", ["xia-tong", "lin-yunshu"], task_intro + "\n\n" + after("（第一輪蒐證）", 9).split("\n", 6)[-1], ["10-11.jpg"],
         "林雲書扮演小廖、夏瞳扮演文琦。道具：桌子、光源、皮帶。他們要在皮帶上下毒；DM 本幕流程裡會主動碰皮帶，也會給他們下毒的時機。" + SEARCH_NOTE),
        ("12-13", "蒐證任務卡二（姜沁＆王之喻）", "第四幕", ["jiang-qin", "wang-zhiyu"], task_intro + "\n\n" + after("（第二輪蒐證）", 3), ["12-13.jpg"],
         "王之喻扮演小廖、姜沁扮演文琦。道具：桌子、光源、盤子與一片肉餅。他們要在肉餅上下毒；DM 可以留幾句話特意背對肉餅，給他們下毒機會。" + SEARCH_NOTE),
        ("14-15", "蒐證任務卡三（簡辭＆簡菲菲）", "第四幕", ["jian-ci", "jian-feifei"], task_intro + "\n\n" + after("（簡辭& 簡菲菲）", 3), ["14-15.jpg"],
         "簡辭扮演小廖、簡菲菲扮演文琦。道具：桌子、光源、匕首。他們要在刀柄上下毒；DM 可以留幾句話特意背對匕首，給他們下毒機會。" + SEARCH_NOTE + "趕走玩家後把文琦單獨叫回房間（小黑屋），小廖想一起進來也可以。"),
        ("16", "還原線索·賭場錄影", "第五幕", "all", "在遊輪賭場的錄影中，只有六個人。", ["16.jpg"], "說明他們六位當中有兩位是同一個人。"),
        ("17", "還原線索·粉色長裙", "第五幕", "all", "在林雲書的行李箱中，翻出了一條陳舊的粉色長裙。", ["17.jpg"], "裙子是林音的；簡菲菲第四幕開頭提過粉色兒童房裡的公主裙，說明林雲書撿回來的瘋兔子就是簡菲菲。"),
        ("18", "還原線索·懷孕", "第五幕", "all", "夏瞳上船時，曾說過自己懷孕了，女兒叫林音。", ["18.jpg"], "林音已死，夏瞳吃了林音的肉瘤變成瘋兔子，把頭上的肉瘤理解為女兒。"),
        ("19", "還原線索·登船名單", "第五幕", "all", "根據遊輪的登船名單，除了船長陸江遠之外，其餘所有人都是瘋兔子。", ["19.jpg"], "證明所有人上船前都已經是瘋兔子。"),
        ("20", "還原線索·林音的病例", "第五幕", "all", "根據林音的病例，她的內心始終是個長不大的孩子，最終死在了二十歲。", ["20.jpg"], "實錘林音已死，18 號線索「懷了林音」的資訊一定有問題。"),
        ("21", "還原線索·陳舊信件", "第五幕", "all", "在姜沁的行李箱中發現了一封簡菲菲的陳舊信件，其中寫明了簡辭的身世。", ["21.jpg"], "證明姜沁、簡辭、簡菲菲都清楚簡辭是文琦和廖向冬的孩子。"),
        ("22", "臺詞卡·林雲書", "第七幕", "lin-yunshu", between(hb, "林雲書臺詞卡", "臺詞說完話術："), ["22.jpg"], "小劇場 1 結束後發放。"),
        ("23", "臺詞卡·姜沁", "第七幕", "jiang-qin", between(hb, "姜沁臺詞卡", "話術："), ["23.jpg"], "小劇場 2 結束後發放。"),
        ("24-25", "臺詞卡·簡辭＆王之喻", "第七幕", ["jian-ci", "wang-zhiyu"], between(hb, "簡辭& 王之喻臺詞卡", "話術："), ["24-25.jpg"], "小劇場 3 結束後發放。"),
        ("26", "臺詞卡·簡菲菲", "第七幕", "jian-feifei", between(hb, "簡菲菲臺詞卡", "話術："), ["26.jpg"], "小劇場 4 結束後發放。"),
        ("27", "臺詞卡·夏瞳", "第七幕", "xia-tong", between(hb, "夏瞳臺詞卡", "話術："), ["27.jpg"], "小劇場 5 結束後發放。"),
    ]

    out = []
    for cid, title, group, who, body, images, note in cards:
        clue = {"id": cid, "title": title, "group": group, "label": group, "summary": "", "body": body.strip(), "images": images}
        if who == "all":
            clue["audience"] = "all"
        elif who == "pick":
            clue["audience"] = "pick"
        else:
            clue["audience"] = "role"
            clue["targets"] = who if isinstance(who, list) else [who]
        if note:
            clue["hostNote"] = note
        if cid == "poker":
            clue["widget"] = "poker"
        out.append(clue)
    return out


# 掃描檔頁面 → 線索卡編號（依卡面右下角印的號碼對過）
PAGES = {
    "故事背景.pdf": ["01"],
    "游戏规则.pdf": ["03"],
    "卡牌线索.pdf": ["05", "04"],
    "触发线索.pdf": ["06", "07", "08"],
    "飞升仪式.pdf": ["09"],
    "搜证卡.pdf": ["10-11", "12-13", "14-15"],
    "还原线索.pdf": ["16", "17", "18", "19", "20", "21"],
}
# 臺詞卡已在 raw/extra 轉成與上面同規格的圖（長邊 1600px）
LINE_CARDS = {"22": "臺詞卡22_", "23": "臺詞卡23_", "24-25": "臺詞卡24-25_", "26": "臺詞卡26_", "27": "臺詞卡27_"}


def extra_file(folder: str, prefix: str) -> Path:
    hits = sorted((EXTRA / folder).glob(f"{prefix}*.jpg"))
    if len(hits) != 1:
        raise SystemExit(f"raw/extra/{folder}/ 找不到唯一的 {prefix}*.jpg（找到 {len(hits)} 個）")
    return hits[0]


def build_images():
    import pymupdf

    dest = ROOT / "cards"
    dest.mkdir(exist_ok=True)
    for pdf, ids in PAGES.items():
        doc = pymupdf.open(RAW / "clues" / pdf)
        assert len(doc) == len(ids), f"{pdf} 頁數 {len(doc)} 與對照表 {len(ids)} 不符"
        for page, cid in zip(doc, ids):
            # 手機螢幕看得清楚就好，長邊約 1600px
            zoom = 1600 / max(page.rect.width, page.rect.height)
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            pix.save(dest / f"{cid}.jpg", jpg_quality=80)
    for cid, prefix in LINE_CARDS.items():
        shutil.copyfile(extra_file("臺詞卡", prefix), dest / f"{cid}.jpg")
    print(f"  線索卡圖片：{sum(len(v) for v in PAGES.values()) + len(LINE_CARDS)} 張")


def resize_to(src: Path, dest: Path, long_side: int, quality: int):
    from PIL import Image

    im = Image.open(src).convert("RGB")
    im.thumbnail((long_side, long_side))
    im.save(dest, "JPEG", quality=quality, optimize=True)


# ---------------- 手冊板書／示意圖（AUDIT 🔴5） ----------------

# (段落標題, 錨點那一行包含的文字, 插在錨點之前？, 圖檔, 來源, 圖說＝板書文字版)
BOARD_ACT3 = "板書｜分身→夢主：林雲書→姜沁、姜沁→夏瞳、簡辭→王之喻、簡菲菲→林雲書、王之喻→簡菲菲、夏瞳→簡辭｜六芒星（凶→死）：王→菲、菲→林、林→夏、夏→簡、簡→姜、姜→王"
HB_IMAGES = [
    ("第二幕", "畫好右側圖，代表客房區域", False, "hb-act2-rooms-blank.jpg", "手冊p35_第二幕_103分屍案_客房區空白圖",
     "客房區示意：走道兩側各 5 間房，箭頭是入口方向"),
    ("第二幕", "（左右房型調換也是一樣）", False, "hb-act2-rooms-original.jpg", "手冊p35_第二幕_103分屍案_原始房號排序",
     "原始房號：從入口往內，左側海景 101、102、103、104、105，右側內景 106、107、108、109、110"),
    ("第二幕", "方式如右側圖。", False, "hb-act2-rooms-swapped.jpg", "手冊p35_第二幕_103分屍案_調換門牌後房號",
     "調換門牌後：從入口往內，左側海景 101、103、105、107、109，右側內景 102、104、106、108、110（左右房型調換也一樣）"),
    ("第三幕", "（盤完後板書如下）", False, "hb-act3-board.jpg", "手冊p40_", BOARD_ACT3),
    ("第三幕", "確認本體都死了後", True, "hb-act3-board-again.jpg", "手冊p43_", "同上：" + BOARD_ACT3),
    ("第四幕", "（增加板書，內容如下）", False, "hb-act4-board.jpg", "手冊p59_",
     "增加板書｜左表「夏瞳→簡辭」改為「夏瞳→簡辭／廖向冬」，新增「其他分身→廖向冬／簡辭」｜六芒星中央加上「夏→廖」"),
    ("第五幕", "首先最大的變數則是", False, "hb-act5-board-before.jpg", "手冊p70_",
     "修正前的板書（同第四幕）。原手冊這裡少了一句提問，下面直接接答案"),
    ("第五幕", "所以就是姜沁殺死了簡辭的本體。（修正板書）", False, "hb-act5-board-final.jpg", "手冊p71_",
     "修正後板書｜分身→夢主：林雲書→姜沁、姜沁→夏瞳、簡辭→王之喻、簡菲菲→林雲書、王之喻→簡菲菲、夏瞳→簡辭／廖向冬（刪掉「其他分身」）｜六芒星（凶→死）：王→菲、菲→林、林→夏、夏→廖、簡→姜、姜→王"),
]


def build_handbook(hb):
    """DM 手冊依階段切段，主持台「手冊」分頁逐段閱讀"""
    marks = [("前期準備", "前期準備"), ("開場階段", "開場階段")]
    marks += [(f"第{n}幕", f"第{n}幕") for n in NUM]
    marks += [("附件：故事覆盤", "覆盤")]
    # 手冊前面有一張總覽表也用了「第一幕」等字樣，要從「開場階段」正文之後才開始找
    body_start = hb.index("（本幕需提前準備：故事背景01、頭套*1、破冰遊戲卡02、人物劇本*6）") - 1
    starts = []
    for title, marker in marks:
        if marker in ("前期準備",):
            idx = hb.index(marker)
        elif marker == "覆盤":
            idx = max(k for k, t in enumerate(hb) if t == marker)
        else:
            idx = next(k for k in range(body_start, len(hb)) if hb[k] == marker)
        starts.append((idx, title))
    starts.sort()
    sections = []
    for n, (idx, title) in enumerate(starts):
        end = starts[n + 1][0] if n + 1 < len(starts) else len(hb)
        sections.append({"title": f"DM 手冊・{title}", "note": "\n".join(hb[idx + 1 : end]), "rows": []})

    for sec_title, anchor, before, img, _, caption in HB_IMAGES:
        sec = next(s for s in sections if s["title"] == f"DM 手冊・{sec_title}")
        sec["note"] = insert_after(sec["title"], sec["note"], "\n", anchor, f"[[img:{img}|{caption}]]", before=before)
    print(f"  DM 手冊：{len(sections)} 段，板書圖 {len(HB_IMAGES)} 張")
    return sections


# ---------------- 圖檔：劇本插圖、手冊板書、角色海報 ----------------

POSTERS = {"xia-tong": "夏瞳", "jian-feifei": "简菲菲", "jiang-qin": "姜沁", "jian-ci": "简辞", "lin-yunshu": "林云书", "wang-zhiyu": "王之喻"}


def build_art():
    images = ROOT / "images"
    images.mkdir(exist_ok=True)
    for _, _, img, prefix in DOC_IMAGES:
        # 跨頁插圖，手機上長邊 1400px 就夠
        resize_to(extra_file("劇本插圖", prefix), images / img, 1400, 82)
    for *_, img, prefix, _ in HB_IMAGES:
        shutil.copyfile(extra_file("手冊圖", prefix), images / img)
    posters = ROOT / "posters"
    posters.mkdir(exist_ok=True)
    for role_id, name in POSTERS.items():
        resize_to(EXTRA / "角色海報" / f"{name}.jpg", posters / f"{role_id}.jpg", 900, 80)
    print(f"  插圖 {len(DOC_IMAGES)} 張、板書 {len(HB_IMAGES)} 張、角色海報 {len(POSTERS)} 張")


if __name__ == "__main__":
    hb = handbook_lines()
    docs = build_docs(slogans(hb))
    (ROOT / "docs.json").write_text(json.dumps(docs, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    cards = build_cards(hb)
    (ROOT / "cards.json").write_text(json.dumps(cards, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    print(f"  線索：{len(cards)} 張")
    build_images()
    (ROOT / "handbook.json").write_text(json.dumps(build_handbook(hb), ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    build_art()
    (RAW / "build-review.txt").write_text("\n".join(review) + "\n", encoding="utf8")
    print(f"  人工核對清單：raw/build-review.txt（{len(review)} 筆）")
