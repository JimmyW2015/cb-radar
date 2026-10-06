"""把證交所「上市／上櫃有價證券清單」(ISIN) 的產業別寫進 stocks.industry。

用法：python sync_industry.py
資料來源：https://isin.twse.com.tw/isin/C_public.jsp?strMode=2（上市）／4（上櫃），欄位：代號　名稱 | ISIN | 上市日 | 市場別 | 產業別 | CFI | 備註
只更新 stocks 表裡已有的股票；沒有產業別（例如創新板）的不寫。
"""
import os
import re
import sys
import time

import requests

import price_history as p


def fetch_industries() -> dict:
    out = {}
    for mode in ("2", "4"):
        r = requests.get(f"https://isin.twse.com.tw/isin/C_public.jsp?strMode={mode}", headers=p.HDR, timeout=120)
        r.raise_for_status()
        text = r.content.decode("cp950", errors="replace")
        for tr in re.findall(r"<tr>(.*?)</tr>", text, re.S):
            tds = [re.sub(r"<[^>]+>", "", x).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
            if len(tds) >= 5 and re.match(r"^\d{4,6}\u3000", tds[0]) and tds[4]:
                out.setdefault(tds[0].split("\u3000")[0], tds[4])
    return out


def main():
    db = p.Db()
    industries = fetch_industries()
    stocks = [s["stock_code"] for s in db.select("stocks", "stock_code")]
    rows = [{"stock_code": c, "industry": industries[c]} for c in stocks if c in industries]
    db.upsert("stocks", rows, "stock_code")
    missing = [c for c in stocks if c not in industries]
    print(f"[industry] 更新 {len(rows)} 檔；沒有產業別 {len(missing)} 檔：{missing[:20]}")
    backfill_auction_stock_codes(db)


# ---------- 承銷公告的公司 → 母股代號（讓歷史頁／競拍頁可用股票代號搜尋，已下線的券也找得到）----------

COMPANY_LISTS = (
    ("https://openapi.twse.com.tw/v1/opendata/t187ap03_L", "公司代號", "公司名稱"),
    ("https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O", "SecuritiesCompanyCode", "CompanyName"),
)


def fetch_company_names() -> dict:
    """上市＋上櫃公司「全名 → 股票代號」。櫃買的 OpenAPI 偶爾會斷線，失敗就重試。"""
    out = {}
    for url, code_key, name_key in COMPANY_LISTS:
        for attempt in range(6):
            try:
                r = requests.get(url, headers={**p.HDR, "Accept-Encoding": "identity"}, timeout=90)
                rows = r.json()
                break
            except (requests.RequestException, ValueError):
                time.sleep(2 * (attempt + 1))
        else:
            print(f"[stock_code] 取不到 {url}，略過這個市場", file=sys.stderr)
            continue
        for row in rows:
            code, name = str(row.get(code_key, "")).strip(), str(row.get(name_key, "")).strip()
            if code and len(name) >= 4:
                out[name] = code
    return out


def match_stock_code(company: str, names: dict):
    """公告上的公司名可能帶「(第四次)」「-KY」或英文名，取『被包含的最長全名』當作母股。"""
    company = re.sub(r"\s+", "", company).replace("股份有公司", "股份有限公司").replace("股分有限公司", "股份有限公司")
    hits = [n for n in names if n in company]
    return names[max(hits, key=len)] if hits else None


def backfill_auction_stock_codes(db) -> None:
    names = fetch_company_names()
    # 現行 CB 母股的全名（來自 MIS）也加進去，補上開放資料名稱寫法不同的公司
    for st in db.select("stocks", "stock_code,name"):
        if st.get("name") and len(st["name"]) >= 4:
            names.setdefault(st["name"], st["stock_code"])
    if not names:
        return
    auctions = db.select("auctions", "case_no,company,cb_code,stock_code", order="case_no.asc")
    rows, unmatched = [], 0
    for a in auctions:
        code = match_stock_code(a["company"], names) or (a["cb_code"][:4] if a.get("cb_code") else None)
        if not code:
            unmatched += 1
        elif code != a.get("stock_code"):
            rows.append({"case_no": a["case_no"], "stock_code": code})
    for r in rows:
        requests.patch(
            f"{db.url}/rest/v1/auctions",
            params={"case_no": f"eq.{r['case_no']}"},
            json={"stock_code": r["stock_code"]},
            headers={**db.h, "Content-Type": "application/json", "Prefer": "return=minimal"},
            timeout=30,
        ).raise_for_status()
    print(f"[stock_code] 公告 {len(auctions)} 筆，更新 {len(rows)} 筆，找不到母股 {unmatched} 筆")


if __name__ == "__main__":
    sys.exit(main())
