#!/usr/bin/env python3
"""
把瘋兔子的原始檔整理成線上主持用的內容。

    pip install pymupdf
    python tools/online/build-fengtuz-content.py

讀取（上傳後整理完就會從 repo 移除，要重建時請重新放回）：
    content/online/fengtuz/raw/scripts/*·列印版.docx   6 本人物劇本＋DM 手冊（繁體整理版）
    content/online/fengtuz/raw/clues/*.pdf              線索卡掃描檔（每頁一張卡）

產出：
    content/online/fengtuz/docs.json      每個角色依幕切好的劇本
    content/online/fengtuz/cards.json     27 張線索卡（文字取自 DM 手冊）
    content/online/fengtuz/cards/*.jpg    線索卡圖片
    content/online/fengtuz/handbook.json  DM 手冊依階段切段，放在主持台「手冊」分頁
"""
import html
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "content" / "online" / "fengtuz"
RAW = ROOT / "raw"

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


def paragraphs(path: Path) -> list[str]:
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf8")
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        t = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", p))
        out.append(html.unescape(t).strip())
    return [t for t in out if t]


# 紙本翻頁提示，線上改由主持人開放，不需要顯示
NOISE = re.compile(r"未經主持人允許|——\s*請勿翻開下一頁\s*——")


def slogans(hb):
    """手冊「分發角色」那段：夏瞳（女）：我會把女兒，一寸一寸的救回來。"""
    out = {}
    for t in hb:
        m = re.match(r"^(\S+?)（[男女]）：(.+)$", t)
        if m and m.group(1) in ROLES.values():
            out[m.group(1)] = m.group(2)
    return out


def build_docs():
    docs = {}
    for role_id, name in ROLES.items():
        lines = paragraphs(RAW / "scripts" / f"{name}·列印版.docx")
        start = lines.index("第一幕")
        # 封面到第一幕之間：出版資訊之後是角色的一句話 slogan
        # 劇本封面的 slogan 是掃描 OCR，會混進雜字；改用 DM 手冊分角時的版本
        hint = SLOGANS[name]

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

        docs[role_id] = {
            "hint": hint,
            "list": [
                {"id": s["id"], "book": "人物劇本", "title": s["title"], "unlockAny": s["unlockAny"], "body": "\n\n".join(s["lines"])}
                for s in sections
            ],
        }
        print(f"  {name}：{len(sections)} 段，slogan「{hint}」")
    return docs


def handbook_lines():
    return paragraphs(RAW / "scripts" / "《瘋兔子》手冊·列印版.docx")


def between(lines, start, end):
    """取 start 那一行之後、end 那一行之前的內容（都用完全比對）"""
    i = lines.index(start)
    j = lines.index(end, i + 1) if end else len(lines)
    return "\n".join(lines[i + 1 : j])


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
        ("04", "卡牌案線索·袖裡的魚線", "第一幕", "all", "陸江遠的袖子裡，有一根魚線，魚線後面還沾了些透明膠。可完成「袖裡乾坤」換牌手法。", ["04.jpg"], "表明陸江遠出千成性，這次賭局也帶了出千工具（袖裡換牌）。"),
        ("05", "卡牌案線索·辭退信", "第一幕", "all", "一封辭退信——陸江遠作為荷官，在與遊客賭牌時出千，因未對公司造成損失，故僅作辭退處理。", ["05.jpg"], "同時發放棄牌堆、新牌堆（貼毒牌標記）與小塑膠瓶。"),
        ("06", "觸發線索·遊輪佈局", "第二幕", "all", "廖向冬回憶：\n（關鍵詞：遊輪佈局）\n\n我記得第一具屍體是在船尾甲板，而且遊輪佈局沒什麼特別的，一樓甲板，二樓客房，三樓駕駛室。", ["06.jpg"], "觸發式：玩家提到關鍵詞再發；卡住也可直接發。強調屍體在船尾，船尾有船錨，操控船錨的駕駛室在三樓。"),
        ("07", "觸發線索·新風系統", "第二幕", "all", "廖向冬回憶：\n（關鍵詞：新風系統）\n\n事後我又去了一趟駕駛室，我當時也懷疑新風系統出了什麼問題，它就在每間房靠近房門的牆壁上。但新風系統是好的，單向和雙向運行都正常。", ["07.jpg"], "觸發式。房內新風系統可單向排風，導致死者窒息、廖向冬打不開門；系統是好的，代表死者可以自己關掉排風。"),
        ("08", "觸發線索·門牌號", "第二幕", "all", "廖向冬回憶：\n（關鍵詞：門牌號）\n\n可能吧，但我不確定。因為我幾乎沒怎麼去過客房部，而且又有兩個人被殺了，加上我感覺我頭上的肉瘤開始吞噬我的理智了，沒注意到也是正常。", ["08.jpg"], "觸發式。強調廖向冬已經沒什麼理智了（調換門牌詭計）。"),
        ("09", "飛昇儀式", "第三幕", "all", after("①發放線索【飛昇儀式】09", 12).replace("飛昇儀式\n", "", 1), ["09.jpg"], ""),
        ("10-11", "蒐證任務卡一（夏瞳＆林雲書）", "第四幕", ["xia-tong", "lin-yunshu"], task_intro + "\n\n" + after("（第一輪蒐證）", 9).split("\n", 6)[-1], ["10-11.jpg"], "男生扮演小廖、女生扮演文琦。道具：桌子、光源、皮帶。"),
        ("12-13", "蒐證任務卡二（姜沁＆王之喻）", "第四幕", ["jiang-qin", "wang-zhiyu"], task_intro + "\n\n" + after("（第二輪蒐證）", 3), ["12-13.jpg"], "道具：桌子、光源、盤子與一片肉餅。"),
        ("14-15", "蒐證任務卡三（簡辭＆簡菲菲）", "第四幕", ["jian-ci", "jian-feifei"], task_intro + "\n\n" + after("（簡辭& 簡菲菲）", 3), ["14-15.jpg"], "道具：桌子、光源、匕首。"),
        ("16", "還原線索·賭場錄影", "第五幕", "all", "在遊輪賭場的錄影中，只有六個人。", ["16.jpg"], "說明他們六位當中有兩位是同一個人。"),
        ("17", "還原線索·粉色長裙", "第五幕", "all", "在林雲書的行李箱中，翻出了一條陳舊的粉色長裙。", ["17.jpg"], "裙子是林音的；夏瞳第四幕提過房間有粉色長裙，說明林雲書撿回來的瘋兔子就是簡菲菲。"),
        ("18", "還原線索·懷孕", "第五幕", "all", "夏瞳上船時，曾說過自己懷孕了，女兒叫林音。", ["18.jpg"], "林音已死，夏瞳吃了林音的肉瘤變成瘋兔子，把頭上的肉瘤理解為女兒。"),
        ("19", "還原線索·登船名單", "第五幕", "all", "根據遊輪的登船名單，除了船長陸江遠之外，其餘所有人都是瘋兔子。", ["19.jpg"], "證明所有人上船前都已經是瘋兔子。"),
        ("20", "還原線索·林音的病例", "第五幕", "all", "根據林音的病例，她的內心始終是個長不大的孩子，最終死在了二十歲。", ["20.jpg"], "實錘林音已死，18 號線索「懷了林音」的資訊一定有問題。"),
        ("21", "還原線索·陳舊信件", "第五幕", "all", "在姜沁的行李箱中發現了一封簡菲菲的陳舊信件，其中寫明了簡辭的身世。", ["21.jpg"], "證明姜沁、簡辭、簡菲菲都清楚簡辭是文琦和廖向冬的孩子。"),
        ("22", "臺詞卡·林雲書", "第七幕", "lin-yunshu", between(hb, "林雲書檯詞卡", "臺詞說完話術："), [], "小劇場 1 結束後發放。"),
        ("23", "臺詞卡·姜沁", "第七幕", "jiang-qin", between(hb, "姜沁臺詞卡", "話術："), [], "小劇場 2 結束後發放。"),
        ("24-25", "臺詞卡·簡辭＆王之喻", "第七幕", ["jian-ci", "wang-zhiyu"], between(hb, "簡辭& 王之喻臺詞卡", "話術："), [], "小劇場 3 結束後發放。"),
        ("26", "臺詞卡·簡菲菲", "第七幕", "jian-feifei", "", [], "小劇場 4 結束後發放。"),
        ("27", "臺詞卡·夏瞳", "第七幕", "xia-tong", between(hb, "夏瞳臺詞卡", "話術："), [], "小劇場 5 結束後發放。"),
    ]
    # 簡菲菲的臺詞卡在手冊裡標題誤植成「簡辭& 王之喻臺詞卡」（第二次出現），用發放那一行定位
    i = hb.index("②發放【臺詞卡】26 給簡菲菲")
    j = hb.index("話術：", i + 2)
    fei = "\n".join(hb[i + 2 : j])

    out = []
    for cid, title, group, who, body, images, note in cards:
        if cid == "26":
            body = fei
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
    print(f"  線索卡圖片：{sum(len(v) for v in PAGES.values())} 張")


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
    print(f"  DM 手冊：{len(sections)} 段")
    return sections


if __name__ == "__main__":
    hb = handbook_lines()
    SLOGANS = slogans(hb)
    docs = build_docs()
    (ROOT / "docs.json").write_text(json.dumps(docs, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    cards = build_cards(hb)
    (ROOT / "cards.json").write_text(json.dumps(cards, ensure_ascii=False, indent=1) + "\n", encoding="utf8")
    print(f"  線索：{len(cards)} 張")
    build_images()
    (ROOT / "handbook.json").write_text(json.dumps(build_handbook(hb), ensure_ascii=False, indent=1) + "\n", encoding="utf8")
