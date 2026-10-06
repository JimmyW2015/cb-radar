"""把證交所「上市／上櫃有價證券清單」(ISIN) 的產業別寫進 stocks.industry。

用法：python sync_industry.py
資料來源：https://isin.twse.com.tw/isin/C_public.jsp?strMode=2（上市）／4（上櫃），欄位：代號　名稱 | ISIN | 上市日 | 市場別 | 產業別 | CFI | 備註
只更新 stocks 表裡已有的股票；沒有產業別（例如創新板）的不寫。
"""
import os
import re
import sys

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


if __name__ == "__main__":
    sys.exit(main())
