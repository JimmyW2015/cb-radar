"""
每日排程：抓 TWSA(證券商公會)承銷公告，篩出可轉換公司債/交換公司債案件，
下載公告 PDF 解析開標結果，寫入 Supabase 的 auctions 表。

這支要放在使用者自己的電腦/主機執行（Windows工作排程器排程），
因為 TWSA 網站會擋掉雲端資料中心的連線（Supabase Edge Function 測試被拒絕），
本機的一般網路連線不受影響。

使用前：
  1. pip install requests beautifulsoup4 pypdf
  2. 在同目錄建立 .env 檔（參考 .env.example），填入 SUPABASE_URL 與
     SUPABASE_SERVICE_ROLE_KEY（在 Supabase Dashboard > Settings > API 取得，
     這是有寫入權限的密鑰，不要外流、不要放進任何會被公開/上傳的地方）。
  3. 手動執行一次確認：python sync_auctions.py
  4. 用 Windows 工作排程器每天排程執行一次（建議傍晚收盤後，公告多在盤後更新）。
"""

import json
import os
import re
import sys
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
from io import BytesIO

BASE = "https://web.twsa.org.tw/edoc2/"
UA = "Mozilla/5.0 (cb-radar sync-auctions local script)"
MAX_PDFS_PER_RUN = 40
REQUEST_DELAY_SEC = 0.6
BID_STATS_SEEN_FILE = Path(__file__).parent / ".bid_stats_seen.json"


def extract_text(pdf_bytes: bytes) -> str:
    reader = PdfReader(BytesIO(pdf_bytes))
    raw = "\n".join(page.extract_text() or "" for page in reader.pages)
    # TWSA's PDF font maps some CJK chars (日/高/金/頁/方...) to CJK Radical
    # Supplement look-alikes instead of the standard codepoints, which silently
    # breaks regex matching on words like 開標日期 unless normalized first.
    return unicodedata.normalize("NFKC", raw)


def load_env():
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def roc_to_iso(y, m, d):
    year = int(y) + 1911
    return f"{year}-{int(m):02d}-{int(d):02d}"


def slash_date_to_iso(s):
    m = re.search(r"(\d{4})/(\d{1,2})/(\d{1,2})", s or "")
    if not m:
        return None
    y, mo, d = m.groups()
    return f"{y}-{int(mo):02d}-{int(d):02d}"


def parse_pdf_fields(text: str) -> dict:
    out = {}

    m = re.search(r"依票面金額\s*([\d.]+)\s*%\s*發行", text)
    if m:
        out["issue_price_pct"] = float(m.group(1))
    if "issue_price_pct" not in out:
        m = re.search(r"發行價格為\s*([\d.]+)\s*元", text)
        if m:
            out["issue_price_pct"] = float(m.group(1))

    m = re.search(r"轉換溢價率\s*([\d.]+)\s*%", text)
    if m:
        out["conversion_premium_pct"] = float(m.group(1))

    m = re.search(r"每股轉換價格為\s*([\d.]+)\s*元", text)
    if m:
        out["conversion_price"] = float(m.group(1))

    m = re.search(r"合\s*計\s*([\d,]+)\s*張\s*([\d,]+)\s*張\s*([\d,]+)\s*張", text)
    if m:
        out["self_retained_lots"] = float(m.group(1).replace(",", ""))
        out["auction_lots"] = float(m.group(2).replace(",", ""))
        out["total_lots"] = float(m.group(3).replace(",", ""))

    m = re.search(r"(?:業於|係以)\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日(?:開標日|完成)", text)
    if m:
        out["bid_opening_date"] = roc_to_iso(*m.groups())

    m = re.search(r"截止日為\s*(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日止", text)
    if m:
        out["payment_deadline"] = roc_to_iso(*m.groups())

    return out


def fetch_list_page(session: requests.Session, year: int | None = None):
    res = session.get(BASE, headers={"User-Agent": UA}, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    def val(id_):
        el = soup.find(id=id_)
        return el.get("value", "") if el else ""

    if year is not None and year != datetime.now().year:
        res = session.post(BASE, data={
            "__EVENTTARGET": "ctl00$cphMain$ddlYear",
            "__EVENTARGUMENT": "",
            "__LASTFOCUS": "",
            "__VIEWSTATE": val("__VIEWSTATE"),
            "__VIEWSTATEGENERATOR": val("__VIEWSTATEGENERATOR"),
            "__EVENTVALIDATION": val("__EVENTVALIDATION"),
            "ctl00$cphMain$ddlYear": str(year),
            "ctl00$cphMain$rblReportType": "UnderwritingNotice",
        }, headers={"User-Agent": UA}, timeout=30)
        res.raise_for_status()
        soup = BeautifulSoup(res.text, "html.parser")

    hidden = {
        "__VIEWSTATE": val("__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": val("__VIEWSTATEGENERATOR"),
        "__EVENTVALIDATION": val("__EVENTVALIDATION"),
    }

    rows = []
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 11:
            continue
        case_no = tds[0].get_text(strip=True)
        if not re.fullmatch(r"\d{6}", case_no):
            continue
        issue_type = tds[6].get_text(strip=True)
        if not re.search(r"轉換公司債|交換公司債", issue_type):
            continue
        img = tds[10].find("input", {"type": "image"})
        rows.append({
            "case_no": case_no,
            "report_date": slash_date_to_iso(tds[1].get_text(strip=True)),
            "underwriter": tds[2].get_text(strip=True),
            "company": tds[3].get_text(strip=True),
            "bond_type": issue_type,
            "method": tds[7].get_text(strip=True),
            "status": tds[9].get_text(strip=True),
            "img_id": img.get("id") if img else None,
        })
    return hidden, rows


def download_pdf_for_row(session: requests.Session, hidden: dict, img_id: str, year: int | None = None):
    field_name = img_id.replace("_", "$")
    form = {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": hidden["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": hidden["__EVENTVALIDATION"],
        "ctl00$cphMain$ddlYear": str(year or datetime.now().year),
        "ctl00$cphMain$rblReportType": "0",
        f"{field_name}.x": "5",
        f"{field_name}.y": "5",
    }
    res = session.post(BASE, data=form, headers={"User-Agent": UA}, allow_redirects=False, timeout=30)
    loc = res.headers.get("Location")
    if not loc:
        return None, None
    pdf_url = urljoin(BASE, loc)
    pdf_res = session.get(pdf_url, headers={"User-Agent": UA}, timeout=60)
    pdf_res.raise_for_status()
    return pdf_url, extract_text(pdf_res.content)


def fetch_all(url: str, key: str, table: str, select: str, **params) -> list:
    """PostgREST 單次最多回 1000 筆，分頁取完（auctions 以 case_no 排序確保分頁穩定）。"""
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    base = {"select": select, "limit": "1000", **params}
    if table == "auctions":
        base["order"] = "case_no.asc"
    out, offset = [], 0
    while True:
        r = requests.get(f"{url}/rest/v1/{table}", params={**base, "offset": str(offset)},
                         headers=headers, timeout=60)
        r.raise_for_status()
        chunk = r.json()
        out.extend(chunk)
        if len(chunk) < 1000:
            return out
        offset += 1000


def supabase_get_existing_case_nos(url, key):
    return {r["case_no"] for r in fetch_all(url, key, "auctions", "case_no")}


def supabase_upsert(url, key, record, table="auctions", on_conflict="case_no"):
    res = requests.post(
        f"{url}/rest/v1/{table}",
        json=[record],
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        params={"on_conflict": on_conflict},
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"upsert failed ({table}): {res.status_code} {res.text[:300]}")


# ---------------------------------------------------------------------------
# 開標統計表 (bid_stats) — a *separate* TWSA report type ("競拍公告/開標統計表",
# radio value "Auction") from the general 承銷公告 list above. Each row here
# has its own "開標統計表" PDF (imgbtnReportFileName) whose header literally
# states the CB's name AND code, e.g. "志聖三  (24673) 無擔保可轉換公司債" —
# this gives a *reliable* cb_code, unlike fuzzy-matching company names.
# ---------------------------------------------------------------------------

def load_bid_stats_seen() -> set:
    if BID_STATS_SEEN_FILE.exists():
        try:
            return set(json.loads(BID_STATS_SEEN_FILE.read_text(encoding="utf-8")))
        except Exception:
            return set()
    return set()


def save_bid_stats_seen(seen: set):
    BID_STATS_SEEN_FILE.write_text(json.dumps(sorted(seen)), encoding="utf-8")


def switch_to_auction_report(session: requests.Session, hidden: dict, year: int | None = None):
    form = {
        "__EVENTTARGET": "ctl00$cphMain$rblReportType$1",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": hidden["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": hidden["__EVENTVALIDATION"],
        "ctl00$cphMain$ddlYear": str(year or datetime.now().year),
        "ctl00$cphMain$rblReportType": "Auction",
    }
    res = session.post(BASE, data=form, headers={"User-Agent": UA}, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    def val(id_):
        el = soup.find(id=id_)
        return el.get("value", "") if el else ""

    new_hidden = {
        "__VIEWSTATE": val("__VIEWSTATE"),
        "__VIEWSTATEGENERATOR": val("__VIEWSTATEGENERATOR"),
        "__EVENTVALIDATION": val("__EVENTVALIDATION"),
    }

    rows = []
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td")
        if len(tds) < 9:
            continue
        case_no = tds[0].get_text(strip=True)
        if not re.fullmatch(r"\d{6}", case_no):
            continue
        report_btn = tds[9].find("input", {"type": "image"}) if len(tds) > 9 else None
        rows.append({
            "case_no": case_no,
            "company": tds[1].get_text(strip=True),
            "underwriter": tds[2].get_text(strip=True),
            "bond_type": tds[3].get_text(strip=True),
            "report_img_id": report_btn.get("id") if report_btn else None,
        })
    return new_hidden, rows


def download_auction_report_pdf(session: requests.Session, hidden: dict, img_id: str, year: int | None = None):
    field_name = img_id.replace("_", "$")
    form = {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": hidden["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": hidden["__EVENTVALIDATION"],
        "ctl00$cphMain$ddlYear": str(year or datetime.now().year),
        "ctl00$cphMain$rblReportType": "Auction",
        f"{field_name}.x": "5",
        f"{field_name}.y": "5",
    }
    res = session.post(BASE, data=form, headers={"User-Agent": UA}, allow_redirects=False, timeout=30)
    loc = res.headers.get("Location")
    if not loc:
        return None, None
    pdf_url = urljoin(BASE, loc)
    pdf_res = session.get(pdf_url, headers={"User-Agent": UA}, timeout=60)
    pdf_res.raise_for_status()
    return pdf_url, extract_text(pdf_res.content)


def parse_bid_stats_pdf(text: str) -> dict | None:
    header = text.split("得標單價總表")[0]

    m = re.search(r"^(.+?)\s*\((\d{4,6})\)\s*(\S+)", header, re.M)
    if not m:
        return None
    out = {
        "cb_name": m.group(1).strip(),
        "cb_code": m.group(2).strip(),
    }

    m = re.search(r"競拍方式[：:]\s*(\S+)", header)
    if m:
        out["auction_method"] = m.group(1)
    m = re.search(r"主辦承銷商[：:]\s*(\S+)", header)
    if m:
        out["underwriter"] = m.group(1)
    m = re.search(r"最低承銷價格[：:]\s*([\d.]+)", header)
    if m:
        out["floor_price"] = float(m.group(1))
    m = re.search(r"最低得標價格[：:]\s*([\d.]+)", header)
    if m:
        out["min_winning_price"] = float(m.group(1))
    m = re.search(r"最高得標價格[：:]\s*([\d.]+)", header)
    if m:
        out["max_winning_price"] = float(m.group(1))
    m = re.search(r"開標日期[：:]\s*(\d{4})/(\d{1,2})/(\d{1,2})", header)
    if m:
        y, mo, d = m.groups()
        out["bid_opening_date"] = f"{y}-{int(mo):02d}-{int(d):02d}"
    m = re.search(r"公開承銷價格[：:]\s*([\d.]+)", header)
    if m:
        out["issue_price"] = float(m.group(1))
    m = re.search(r"得標加權平均價格[：:]\s*([\d.]+)", header)
    if m:
        out["weighted_avg_price"] = float(m.group(1))

    m = re.search(
        r"合格投標筆數\s*合格投標數量\s*\(\s*仟股\s*\)\s*得標筆數\s*得標數量\s*\(\s*仟股\s*\)\s*得標總金額\s*\(\s*仟元\s*\)\s*"
        r"([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,.]+)",
        header,
    )
    if m:
        out["qualified_bid_count"] = int(m.group(1).replace(",", ""))
        out["qualified_bid_qty"] = float(m.group(2).replace(",", ""))
        out["won_count"] = int(m.group(3).replace(",", ""))
        out["won_qty"] = float(m.group(4).replace(",", ""))
        out["won_amount"] = float(m.group(5).replace(",", ""))

    inst = re.search(r"法人投標、得標統計表(.*?)得標單價總表", text, re.S)
    if inst:
        im = re.search(r"(\d[\d,]*)\s+([\d,]+)\s+[\d.]+\s+(\d[\d,]*)\s+([\d,]+)\s+[\d.]+\s*\n", inst.group(1))
        if im:
            out["inst_qualified_count"] = int(im.group(1).replace(",", ""))
            out["inst_qualified_qty"] = float(im.group(2).replace(",", ""))
            out["inst_won_count"] = int(im.group(3).replace(",", ""))
            out["inst_won_qty"] = float(im.group(4).replace(",", ""))

    ladder = []
    ladder_text = text.split("得標單價總表", 1)[1] if "得標單價總表" in text else ""
    for lm in re.finditer(r"^(\d+)\s+([\d.]+)\s+([\d,]+)\s+([\d,.]+)\s*$", ladder_text, re.M):
        ladder.append({
            "seq": int(lm.group(1)),
            "price": float(lm.group(2)),
            "qty": float(lm.group(3).replace(",", "")),
            "amount": float(lm.group(4).replace(",", "")),
        })
    if ladder:
        out["price_ladder"] = ladder

    return out


def sync_bid_stats(session: requests.Session, supabase_url: str, supabase_key: str, year: int | None = None, limit: int = MAX_PDFS_PER_RUN):
    hidden0, _ = fetch_list_page(session, year)
    hidden, rows = switch_to_auction_report(session, hidden0, year)
    print(f"[bid_stats] 開標統計表清單找到 {len(rows)} 筆競拍案件")

    seen = load_bid_stats_seen()
    todo = [r for r in rows if r["report_img_id"] and r["case_no"] not in seen][:limit]
    print(f"[bid_stats] 已處理過 {len(seen)} 筆，本次處理 {len(todo)} 筆")

    ok, failed, no_report_yet = 0, 0, 0
    for row in todo:
        try:
            pdf_url, text = download_auction_report_pdf(session, hidden, row["report_img_id"], year)
            if not pdf_url:
                no_report_yet += 1
                continue
            fields = parse_bid_stats_pdf(text)
            if not fields or not fields.get("cb_code"):
                print(f"  SKIP {row['case_no']} {row['company']}：PDF格式無法解析出CB代碼", file=sys.stderr)
                failed += 1
                continue
            record = {
                **fields,
                "report_pdf_url": pdf_url,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            supabase_upsert(supabase_url, supabase_key, record, table="bid_stats", on_conflict="cb_code")
            seen.add(row["case_no"])
            ok += 1
            print(f"  ok  {row['case_no']}  {fields['cb_name']}({fields['cb_code']})")
        except Exception as e:
            failed += 1
            print(f"  FAIL {row['case_no']}  {e}", file=sys.stderr)
        time.sleep(REQUEST_DELAY_SEC)

    save_bid_stats_seen(seen)
    print(f"[bid_stats] 完成：成功 {ok} 筆，失敗 {failed} 筆，尚未開標 {no_report_yet} 筆")


# ---------------------------------------------------------------------------
# 時間軸：從承銷公告全文解析各步驟日期，並用 bid_stats 把公告對到 cb_code。
# 對應只在「開標日＋主辦券商相符＋公司名稱含債券名稱前兩字」且雙向唯一時才成立，
# 寧可留空也不模糊配對（見 DEVLOG 踩坑 7）。
# ---------------------------------------------------------------------------

_ROC = r"(\d{2,3})年(\d{1,2})[月日](\d{1,2})日"  # 少數公告把「月」誤植成「日」
_LISTING_CTX = re.compile(r"掛牌|上櫃日期|上市日期|櫃檯買賣開始日|上櫃交易|上櫃買賣|上櫃掛牌")


_CN_DIGIT = {c: str(i) for i, c in enumerate("〇一二三四五六七八九")}
_CN_DIGIT.update({"○": "0", "零": "0"})
_CN_DATE = re.compile(r"([〇○零一二三四五六七八九]{2,3})年([〇○零一二三四五六七八九十]{1,3})月([〇○零一二三四五六七八九十]{1,3})日")


def _cn_num(s: str) -> str:
    if "十" in s:
        head, _, tail = s.partition("十")
        return str(int(_CN_DIGIT.get(head, "1") if head else 1) * 10 + (int(_CN_DIGIT[tail]) if tail else 0))
    return "".join(_CN_DIGIT[c] for c in s)


def _cn_dates_to_arabic(text: str) -> str:
    return _CN_DATE.sub(lambda m: f"{_cn_num(m.group(1))}年{_cn_num(m.group(2))}月{_cn_num(m.group(3))}日", text)


def parse_timeline_dates(text: str) -> dict:
    # PDF 抽字常出現「1 1 3 年」或詞語中間被換行，先去掉所有空白再比對
    text = _cn_dates_to_arabic(re.sub(r"\s+", "", unicodedata.normalize("NFKC", text or "")))
    out = {}

    m = re.search(_ROC + r"(?:作)?為[^。，,;；]{0,8}基準日", text)
    if m:
        out["pricing_base_date"] = roc_to_iso(*m.groups())

    m = re.search(r"扣繳日[：:]" + _ROC, text)
    if m:
        out["deduction_date"] = roc_to_iso(*m.groups())

    m = re.search(r"次一營業日\(" + _ROC, text)
    if m:
        out["refund_date"] = roc_to_iso(*m.groups())

    m = re.search(r"繳款日[^)(]{0,8}\(即(?:民國)?" + _ROC, text) or re.search(r"繳款日(?:為|[：:])?(?:民國)?" + _ROC, text)
    if m:
        out["inquiry_payment_date"] = roc_to_iso(*m.groups())

    m = re.search(r"詢價圈購作業業?於(?:民國)?(\d{2,3})年(\d{1,2})月(\d{1,2})日?完成", text)
    if m:
        out["inquiry_date"] = roc_to_iso(*m.groups())

    om = re.search(r"(?:國內|海外)?第([一二三四五六七八九十]+)次(?:有擔保|無擔保|擔保|轉換|交換)", text)
    if om:
        out["ordinal"] = _cn_to_int(om.group(1))

    for dm in re.finditer(_ROC, text):
        ctx = text[max(0, dm.start() - 30): dm.end() + 20]
        if _LISTING_CTX.search(ctx):
            out["listing_date_planned"] = roc_to_iso(*dm.groups())
            break

    return out


def parse_conversion_price(text: str):
    t = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text or ""))
    for pat in (
        r"每股轉換價格為(?:新[台臺]幣)?([\d,.]+)元",
        r"轉換價格(?:為|:)(?:每股)?(?:新[台臺]幣)?([\d,.]+)元",
        r"轉換價格(?:決定方式)?[^。]{0,200}?(?:即|並|則)?(?:發行之|發行時之)?轉換價格(?:為)?(?:每股)?(?:新[台臺]幣)?([\d,.]+)元",
    ):
        m = re.search(pat, t)
        if m:
            return float(m.group(1).replace(",", ""))
    return None


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").lower()


def _name_matches(company: str, cb_name: str) -> bool:
    base = re.sub(r"\s*ky\s*$", "", _norm(cb_name)).strip()
    base = re.sub(r"[一二三四五六七八九十]+$", "", base).strip()
    return len(base) >= 2 and base[:2] in _norm(company)


def _cn_to_int(s: str) -> int:
    if "十" in s:
        head, _, tail = s.partition("十")
        return (_CN_INT[head] if head else 1) * 10 + (_CN_INT[tail] if tail else 0)
    return _CN_INT[s] if len(s) == 1 else int("".join(str(_CN_INT[c]) for c in s))


_CN_INT = {c: i for i, c in enumerate("〇一二三四五六七八九")}


def _bond_suffix(cb_name: str):
    return re.search(r"([一二三四五六七八九十]+|\d+)(?:ky|創|永|e\d)*$", re.sub(r"\s+", "", _norm(cb_name)))


def _bond_ordinal(cb_name: str):
    m = _bond_suffix(cb_name)
    if not m:
        return None
    t = m.group(1)
    return int(t) if t.isdigit() else _cn_to_int(t)


def _bond_base(cb_name: str) -> str:
    m = _bond_suffix(cb_name)
    return re.sub(r"\s+", "", _norm(cb_name))[: m.start()] if m else ""


def _stem(name):
    n = _norm(name or "")
    return re.split(r"股份|股分|有限公司", n)[0]


def backfill_timeline(url: str, key: str, dry_run: bool = False):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def get(table, select):
        return fetch_all(url, key, table, select)

    auctions = get("auctions", "case_no,company,underwriter,bid_opening_date,cb_code,conversion_price,raw_parsed")
    stats = get("bid_stats", "cb_code,cb_name,underwriter,bid_opening_date")
    names = {s["stock_code"]: _norm(s["name"]) for s in get("stocks", "stock_code,name") if s.get("name")}
    pool = {}
    for b in get("bonds", "cb_code,cb_name,stock_code"):
        pool[b["cb_code"]] = b
    listed = set(pool)  # auctions.cb_code 有 FK 指向 bonds，尚未上市的債券等進 bonds 後再連結
    for b in get("pipeline", "cb_code,cb_name,code"):
        if b["cb_code"] and b["cb_code"] not in pool:
            pool[b["cb_code"]] = {"cb_code": b["cb_code"], "cb_name": b["cb_name"], "stock_code": b["code"]}

    cand = {}
    for a in auctions:
        cand[a["case_no"]] = [
            s["cb_code"] for s in stats
            if a["bid_opening_date"] and s["bid_opening_date"] == a["bid_opening_date"]
            and s.get("underwriter") and a.get("underwriter")
            and (s["underwriter"][:2] in a["underwriter"] or a["underwriter"][:2] in s["underwriter"])
            and _name_matches(a["company"], s["cb_name"])
        ]
    # 開標統計表只涵蓋競價拍賣；同一檔被多件公告命中時，以非詢圈（無詢圈完成日）者為準。
    by_code = {}
    for a in auctions:
        if len(cand[a["case_no"]]) == 1:
            by_code.setdefault(cand[a["case_no"]][0], []).append(a)
    for code, group in by_code.items():
        if len(group) > 1:
            keep = [a for a in group if "inquiry_date" not in parse_timeline_dates((a.get("raw_parsed") or {}).get("full_text"))]
            for a in group:
                if len(keep) != 1 or a is not keep[0]:
                    cand[a["case_no"]] = []

    # 詢圈案件沒有開標統計表：改用公告內文的「第N次」＋公司名稱對到債券（兩者都吻合且唯一才連結）。
    for a in auctions:
        if cand[a["case_no"]]:
            continue
        text = re.sub(r"\s+", "", unicodedata.normalize("NFKC", (a.get("raw_parsed") or {}).get("full_text") or ""))
        om = re.search(r"(?:國內|海外)?第([一二三四五六七八九十]+)次", text)
        if not om:
            continue
        want = _cn_to_int(om.group(1))
        company = _norm(a["company"])
        by_stem, by_base = [], []
        for b in pool.values():
            if _bond_ordinal(b["cb_name"]) != want:
                continue
            nm = _stem(names.get(b.get("stock_code")))
            base = _bond_base(b["cb_name"])
            if nm and nm in company:
                by_stem.append(b["cb_code"])
            elif len(base) >= 2 and company.startswith(base):
                by_base.append(b["cb_code"])
        hits = by_stem or by_base
        if len(hits) == 1:
            cand[a["case_no"]] = hits
    claimed = {}
    for case_no, codes in cand.items():
        if len(codes) == 1:
            claimed.setdefault(codes[0], []).append(case_no)

    for code, cases in claimed.items():
        if len(cases) > 1:
            print(f"  [timeline] 配對不唯一，略過：{code} <- {cases}")
    linked = updated = 0
    pending_cp = {}
    case_link = {}  # bid_stats.cb_code -> 公告案號（不受 bonds FK 限制，供前端把公告和開標統計配起來）
    for a in auctions:
        raw = a.get("raw_parsed") or {}
        text = raw.get("full_text")
        patch = {}
        if text:
            new_tl = parse_timeline_dates(text)
            if raw.get("timeline") != new_tl:
                raw["timeline"] = new_tl
                patch["raw_parsed"] = raw
            if a.get("conversion_price") is None:
                cp = parse_conversion_price(text)
                if cp is not None:
                    patch["conversion_price"] = cp
        codes = cand[a["case_no"]]
        if len(codes) == 1 and len(claimed[codes[0]]) == 1:
            case_link[codes[0]] = a["case_no"]
        if len(codes) == 1 and len(claimed[codes[0]]) == 1 and codes[0] not in listed:
            cp_now = patch.get("conversion_price", a.get("conversion_price"))
            if cp_now is not None:
                pending_cp[codes[0]] = cp_now  # 新上市、尚未進 bonds 的債券：先把轉換價記到 bid_stats，日報算溢價用
        if len(codes) == 1 and len(claimed[codes[0]]) == 1 and codes[0] in listed:
            patch["cb_code"] = codes[0]
            linked += 1
        elif a.get("cb_code"):
            patch["cb_code"] = None
        if patch.get("cb_code") == a.get("cb_code"):
            patch.pop("cb_code", None)
        if dry_run:
            print(a["case_no"], a["company"], patch.get("cb_code"), (raw.get("timeline") or {}))
            continue
        if not patch:
            continue
        r = None
        for attempt in range(3):
            try:
                r = requests.patch(f"{url}/rest/v1/auctions", params={"case_no": f"eq.{a['case_no']}"},
                                   json=patch, headers={**headers, "Content-Type": "application/json",
                                                        "Prefer": "return=minimal"}, timeout=60)
                break
            except requests.RequestException:
                time.sleep(2 * (attempt + 1))
        if r is None or not r.ok:
            print(f"  FAIL timeline {a['case_no']} {r.status_code if r is not None else 'timeout'}", file=sys.stderr)
            continue
        updated += 1
    if not dry_run:
        for code, case_no in case_link.items():
            requests.patch(f"{url}/rest/v1/bid_stats", params={"cb_code": f"eq.{code}"}, json={"case_no": case_no},
                           headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
        for code, cp in pending_cp.items():
            requests.patch(f"{url}/rest/v1/bid_stats", params={"cb_code": f"eq.{code}", "conversion_price": "is.null"},
                           json={"conversion_price": cp},
                           headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
    print(f"[timeline] 公告 {len(auctions)} 筆，對應到 CB {linked} 筆，已更新 {updated} 筆；待連結新券 {len(pending_cp)} 檔")


# ---------------------------------------------------------------------------
# 開標統計補強：法人投標／得標（舊資料回補）、競拍截止日（開標日前 2 個營業日）
# 與當日母股收盤價，用來在前端算轉換價值與各價位溢價率。
# ---------------------------------------------------------------------------

def _num(x):
    try:
        v = float(str(x).replace(",", ""))
        return v if v > 0 else None
    except ValueError:
        return None


def fetch_month_closes(stock_code: str, market: str, year: int, month: int) -> dict:
    """回傳 {YYYY-MM-DD: 收盤價}，來源為證交所／櫃買中心官方個股日成交資訊。"""
    hdr = {"User-Agent": "Mozilla/5.0"}
    out = {}
    if market == "TPEx":
        res = requests.get("https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock",
                           params={"code": stock_code, "date": f"{year}/{month:02d}/01", "response": "json"},
                           headers=hdr, timeout=30)
        res.raise_for_status()
        tables = res.json().get("tables") or []
        rows = tables[0].get("data", []) if tables else []
    else:
        res = requests.get("https://www.twse.com.tw/exchangeReport/STOCK_DAY",
                           params={"response": "json", "date": f"{year}{month:02d}01", "stockNo": stock_code},
                           headers=hdr, timeout=30)
        res.raise_for_status()
        rows = res.json().get("data", [])
    for row in rows:
        y, m, d = row[0].split("/")
        close = _num(row[6])
        if close is not None:
            out[f"{int(y) + 1911}-{m}-{d}"] = close
    return out


def backfill_bid_extras(url: str, key: str):
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def get(table, select, **params):
        return fetch_all(url, key, table, select, **params)

    rows = get("bid_stats", "cb_code,bid_opening_date,report_pdf_url,inst_qualified_qty,bid_close_date,stock_close,conversion_price")
    stock_of = {b["cb_code"]: b["stock_code"] for b in get("bonds", "cb_code,stock_code")}
    for p in get("pipeline", "cb_code,code"):
        if p["cb_code"] and p["cb_code"] not in stock_of:
            stock_of[p["cb_code"]] = p["code"]
    market_of = {s["stock_code"]: s["market"] for s in get("stocks", "stock_code,market")}
    conv_of = {a["cb_code"]: a["conversion_price"] for a in get("auctions", "cb_code,conversion_price") if a["cb_code"]}

    done = skipped = 0
    for r in rows:
        patch = {}
        if r["inst_qualified_qty"] is None and r["report_pdf_url"]:
            try:
                pdf = requests.get(r["report_pdf_url"], headers={"User-Agent": UA}, timeout=60)
                pdf.raise_for_status()
                fields = parse_bid_stats_pdf(extract_text(pdf.content)) or {}
                patch.update({k: v for k, v in fields.items() if k.startswith("inst_")})
            except Exception as e:
                print(f"  FAIL inst {r['cb_code']} {e}", file=sys.stderr)
        if r["conversion_price"] is None and conv_of.get(r["cb_code"]):
            patch["conversion_price"] = conv_of[r["cb_code"]]
        if r["stock_close"] is None and r["bid_opening_date"]:
            code = stock_of.get(r["cb_code"]) or r["cb_code"][:-1]
            market = market_of.get(code)
            if market:
                try:
                    od = datetime.strptime(r["bid_opening_date"], "%Y-%m-%d")
                    prev = (od.replace(day=1) - timedelta(days=1))
                    closes = {**fetch_month_closes(code, market, prev.year, prev.month),
                              **fetch_month_closes(code, market, od.year, od.month)}
                    before = sorted(d for d in closes if d < r["bid_opening_date"])
                    if len(before) >= 2:
                        patch["bid_close_date"] = before[-2]
                        patch["stock_close"] = closes[before[-2]]
                except Exception as e:
                    print(f"  FAIL close {r['cb_code']} {e}", file=sys.stderr)
                time.sleep(REQUEST_DELAY_SEC)
        if not patch:
            skipped += 1
            continue
        res = requests.patch(f"{url}/rest/v1/bid_stats", params={"cb_code": f"eq.{r['cb_code']}"}, json=patch,
                             headers={**headers, "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=30)
        if res.ok:
            done += 1
        else:
            print(f"  FAIL patch {r['cb_code']} {res.status_code} {res.text[:200]}", file=sys.stderr)
    print(f"[bid_extras] 補強 {done} 筆，無需更新 {skipped} 筆")


def main():
    load_env()
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，請設定 .env 檔", file=sys.stderr)
        sys.exit(1)

    # 用法：python sync_auctions.py            → 只同步今年（每次最多 40 筆）
    #       python sync_auctions.py 2025 2024  → 補抓指定年份（西元年，不限筆數）
    years = [int(y) for y in sys.argv[1:]] or [None]
    limit = MAX_PDFS_PER_RUN if years == [None] else 10_000
    for year in years:
        session = requests.Session()
        hidden, rows = fetch_list_page(session, year)
        print(f"[{datetime.now(timezone.utc).isoformat()}] {year or '今年'} 頁面上找到 {len(rows)} 筆CB相關承銷公告")

        existing = supabase_get_existing_case_nos(supabase_url, supabase_key)
        todo = [r for r in rows if r["case_no"] not in existing][:limit]
        print(f"已同步 {len(existing & {r['case_no'] for r in rows})} 筆，本次處理 {len(todo)} 筆新案件")

        ok, failed = 0, 0
        for row in todo:
            record = {
                "case_no": row["case_no"],
                "report_date": row["report_date"],
                "underwriter": row["underwriter"],
                "company": row["company"],
                "bond_type": row["bond_type"],
                "method": row["method"],
                "status": row["status"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            try:
                if row["img_id"]:
                    pdf_url, text = download_pdf_for_row(session, hidden, row["img_id"], year)
                    if pdf_url:
                        record["pdf_url"] = pdf_url
                        record.update(parse_pdf_fields(text))
                        record["raw_parsed"] = {"full_text": text[:6000]}
                supabase_upsert(supabase_url, supabase_key, record)
                ok += 1
                print(f"  ok  {row['case_no']}  {row['company']}  {row['method']}")
            except Exception as e:
                failed += 1
                print(f"  FAIL {row['case_no']}  {e}", file=sys.stderr)
            time.sleep(REQUEST_DELAY_SEC)

        print(f"完成：成功 {ok} 筆，失敗 {failed} 筆，剩餘待處理約 {len(rows) - len(existing) - ok} 筆")

        print()
        sync_bid_stats(session, supabase_url, supabase_key, year, limit)

    print()
    backfill_timeline(supabase_url, supabase_key)

    print()
    backfill_bid_extras(supabase_url, supabase_key)


if __name__ == "__main__":
    main()
