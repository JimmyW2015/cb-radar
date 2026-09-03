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
from datetime import datetime, timezone
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


def fetch_list_page(session: requests.Session):
    res = session.get(BASE, headers={"User-Agent": UA}, timeout=30)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    def val(id_):
        el = soup.find(id=id_)
        return el.get("value", "") if el else ""

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


def download_pdf_for_row(session: requests.Session, hidden: dict, img_id: str):
    field_name = img_id.replace("_", "$")
    form = {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": hidden["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": hidden["__EVENTVALIDATION"],
        "ctl00$cphMain$ddlYear": str(datetime.now().year),
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


def supabase_get_existing_case_nos(url, key):
    res = requests.get(
        f"{url}/rest/v1/auctions",
        params={"select": "case_no"},
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        timeout=30,
    )
    res.raise_for_status()
    return {r["case_no"] for r in res.json()}


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


def switch_to_auction_report(session: requests.Session, hidden: dict):
    form = {
        "__EVENTTARGET": "ctl00$cphMain$rblReportType$1",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": hidden["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": hidden["__EVENTVALIDATION"],
        "ctl00$cphMain$ddlYear": str(datetime.now().year),
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


def download_auction_report_pdf(session: requests.Session, hidden: dict, img_id: str):
    field_name = img_id.replace("_", "$")
    form = {
        "__EVENTTARGET": "",
        "__EVENTARGUMENT": "",
        "__LASTFOCUS": "",
        "__VIEWSTATE": hidden["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": hidden["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": hidden["__EVENTVALIDATION"],
        "ctl00$cphMain$ddlYear": str(datetime.now().year),
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


def sync_bid_stats(session: requests.Session, supabase_url: str, supabase_key: str):
    hidden0, _ = fetch_list_page(session)
    hidden, rows = switch_to_auction_report(session, hidden0)
    print(f"[bid_stats] 開標統計表清單找到 {len(rows)} 筆競拍案件")

    seen = load_bid_stats_seen()
    todo = [r for r in rows if r["report_img_id"] and r["case_no"] not in seen][:MAX_PDFS_PER_RUN]
    print(f"[bid_stats] 已處理過 {len(seen)} 筆，本次處理 {len(todo)} 筆")

    ok, failed, no_report_yet = 0, 0, 0
    for row in todo:
        try:
            pdf_url, text = download_auction_report_pdf(session, hidden, row["report_img_id"])
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


def main():
    load_env()
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not supabase_key:
        print("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，請設定 .env 檔", file=sys.stderr)
        sys.exit(1)

    session = requests.Session()
    hidden, rows = fetch_list_page(session)
    print(f"[{datetime.now(timezone.utc).isoformat()}] 頁面上找到 {len(rows)} 筆CB相關承銷公告")

    existing = supabase_get_existing_case_nos(supabase_url, supabase_key)
    todo = [r for r in rows if r["case_no"] not in existing][:MAX_PDFS_PER_RUN]
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
                pdf_url, text = download_pdf_for_row(session, hidden, row["img_id"])
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
    sync_bid_stats(session, supabase_url, supabase_key)


if __name__ == "__main__":
    main()
