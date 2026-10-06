"""可轉債與母股的每日 OHLCV 歷史資料：回補 + 每日補漏。

用法：
  python price_history.py cb    2021-09-01     # 從指定日起回補 CB 日行情（櫃買中心每日 CSV）
  python price_history.py stock 2021-09-01     # 從指定日起回補現行 CB 母股日行情（證交所／櫃買）
  python price_history.py all   2021-09-01     # 兩者都做
  python price_history.py conv  2020-12-01     # 回補每月轉換資料（公開資訊觀測站）
  python price_history.py all                  # 不帶日期：只補最近 14 天（每日補漏用）
  python price_history.py export               # 匯出全部資料成 CSV 到 price_archive/（本機備份）

寫入 Supabase 的 cb_prices / stock_prices（只增不減，資料庫有禁止刪除的 trigger）。
同一日期重跑是安全的（upsert）。進度記在 .price_progress.json，中斷後可續跑。
"""
import functools
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

import requests

HDR = {"User-Agent": "Mozilla/5.0"}
TPEX = "https://www.tpex.org.tw"
PROGRESS = Path(__file__).parent / ".price_progress.json"
DELAY = 0.8


def load_env():
    p = Path(__file__).parent / ".env"
    if p.exists():
        for line in p.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def num(x):
    if x is None:
        return None
    s = re.sub(r"[,\s]", "", str(x))
    if s in ("", "--", "---", "X", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def get_retry(url, headers=None, **kw):
    for i in range(4):
        try:
            r = requests.get(url, headers={**HDR, **(headers or {})}, timeout=60, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException:
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed: {url}")


def post_retry(url, headers=None, **kw):
    for i in range(4):
        try:
            r = requests.post(url, headers={**HDR, **(headers or {})}, timeout=60, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException:
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"POST failed: {url}")


class Db:
    def __init__(self):
        load_env()
        self.url = os.environ["SUPABASE_URL"]
        self.key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}

    def upsert(self, table, rows, conflict):
        for i in range(0, len(rows), 1000):
            chunk = rows[i : i + 1000]
            for attempt in range(4):
                try:
                    r = requests.post(
                        f"{self.url}/rest/v1/{table}",
                        params={"on_conflict": conflict},
                        json=chunk,
                        headers={**self.h, "Content-Type": "application/json",
                                 "Prefer": "resolution=merge-duplicates,return=minimal"},
                        timeout=90,
                    )
                    if r.ok:
                        break
                    raise RuntimeError(f"{r.status_code} {r.text[:200]}")
                except requests.RequestException:
                    time.sleep(2 * (attempt + 1))
            else:
                raise RuntimeError(f"upsert {table} failed")

    def select(self, table, select, **params):
        out, off = [], 0
        while True:
            r = requests.get(f"{self.url}/rest/v1/{table}",
                             params={"select": select, "limit": "1000", "offset": str(off), **params},
                             headers=self.h, timeout=60)
            r.raise_for_status()
            chunk = r.json()
            out += chunk
            if len(chunk) < 1000:
                return out
            off += 1000


def load_progress():
    if PROGRESS.exists():
        try:
            return json.loads(PROGRESS.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"cb": [], "stock": []}


def save_progress(p):
    PROGRESS.write_text(json.dumps(p), encoding="utf-8")


# ---------- CB：櫃買中心「轉(交)換債日統計報表」每日 CSV ----------

@functools.lru_cache(maxsize=None)
def cb_files_for_month(y, m):
    """回傳 {YYYY-MM-DD: csv 相對路徑}"""
    r = post_retry(f"{TPEX}/www/zh-tw/bond/cbDaily",
                   data={"date": f"{y}/{m:02d}/01", "fileCode": "rsta0113", "id": "", "response": "json"},
                   headers={"Referer": f"{TPEX}/zh-tw/bond/info/statistics-cb/day.html"})
    out = {}
    for t in r.json().get("tables", []):
        for d, path in t.get("data", []):
            yy, mm, dd = d.split("/")
            out[f"{int(yy) + 1911}-{mm}-{dd}"] = path
    return out


def parse_cb_csv(content: bytes, trade_date: str):
    text = content.decode("cp950", errors="replace")
    rows = []
    last = None
    for line in text.splitlines():
        if not line.startswith("BODY,"):
            continue
        cells = [c.strip().strip('"') for c in next(__import__("csv").reader([line]))][1:]
        if len(cells) < 12:
            continue
        code, name, mode = cells[0], cells[1], cells[2]
        if code:
            last = (code, name) if re.fullmatch(r"\d{4,6}", code) else None
        if not last:
            continue
        close, change, open_, high, low, trades, units, amount, avg = (num(cells[i]) for i in (3, 4, 5, 6, 7, 8, 9, 10, 11))
        if close is None and trades is None:
            continue
        rows.append({
            "cb_code": last[0], "trade_date": trade_date, "mode": mode, "cb_name": last[1],
            "open": open_, "high": high, "low": low, "close": close, "change": change,
            "trades": int(trades) if trades is not None else None,
            "volume": units, "amount": amount, "avg_price": avg,
        })
    return rows


def run_cb(db, since: date, until: date):
    prog = load_progress()
    done = set(prog["cb"])
    y, m = since.year, since.month
    total = 0
    while (y, m) <= (until.year, until.month):
        files = cb_files_for_month(y, m)
        for d in sorted(files):
            dd = date.fromisoformat(d)
            if dd < since or dd > until or d in done:
                continue
            r = get_retry(TPEX + files[d])
            rows = parse_cb_csv(r.content, d)
            if rows:
                db.upsert("cb_prices", rows, "cb_code,trade_date,mode")
            total += len(rows)
            done.add(d)
            prog["cb"] = sorted(done)
            save_progress(prog)
            print(f"[cb] {d} {len(rows)} 筆", flush=True)
            time.sleep(0.3)
        m += 1
        if m == 13:
            y, m = y + 1, 1
    print(f"[cb] 完成，共寫入 {total} 筆")


# ---------- 母股：證交所 MI_INDEX / 櫃買 afterTrading/otc 全市場日行情 ----------

def twse_day(d: str):
    r = get_retry("https://www.twse.com.tw/exchangeReport/MI_INDEX",
                  params={"response": "json", "date": d.replace("-", ""), "type": "ALLBUT0999"})
    j = r.json()
    for t in j.get("tables", []):
        if "每日收盤行情" in (t.get("title") or ""):
            out = {}
            for row in t["data"]:
                txt = re.sub(r"<[^>]*>", "", row[9]).strip()
                sign = -1 if txt == "-" else 1
                diff = num(row[10])
                out[row[0].strip()] = {
                    "open": num(row[5]), "high": num(row[6]), "low": num(row[7]), "close": num(row[8]),
                    "change": diff * sign if diff is not None else None,
                    "trades": int(num(row[3])) if num(row[3]) is not None else None,
                    "volume": num(row[2]), "amount": num(row[4]),
                }
            return out
    return {}


def tpex_day(d: str):
    r = get_retry(f"{TPEX}/www/zh-tw/afterTrading/otc",
                  params={"date": d.replace("-", "/"), "type": "EW", "response": "json"})
    j = r.json()
    out = {}
    for t in j.get("tables", [])[:1]:
        for row in t.get("data", []):
            out[row[0].strip()] = {
                "open": num(row[4]), "high": num(row[5]), "low": num(row[6]), "close": num(row[2]),
                "change": num(row[3]),
                "trades": int(num(row[9])) if num(row[9]) is not None else None,
                "volume": num(row[7]), "amount": num(row[8]),
            }
    return out


def run_stock(db, since: date, until: date):
    stocks = {s["stock_code"]: s["market"] for s in db.select("stocks", "stock_code,market")}
    first = {}
    for b in db.select("bonds", "stock_code,issue_date"):
        if b["stock_code"] and b["issue_date"]:
            first[b["stock_code"]] = min(first.get(b["stock_code"], "9999"), b["issue_date"])
    # 交易日以 CB 日檔案為準（兩者同為營業日）
    days = []
    y, m = since.year, since.month
    while (y, m) <= (until.year, until.month):
        days += [d for d in cb_files_for_month(y, m) if since <= date.fromisoformat(d) <= until]
        m += 1
        if m == 13:
            y, m = y + 1, 1
    days.sort()
    prog = load_progress()
    # IGNORE_FIRST=1：不限制「從該股最早一檔 CB 上市日起」，把所有母股都補到指定起日（用來補足新母股的 60 日均線所需歷史）
    ignore_first = os.environ.get("IGNORE_FIRST") == "1"
    done = set() if ignore_first else set(prog["stock"])
    total = 0
    for d in days:
        if d in done:
            continue
        rows = []
        for market, fn in (("TSE", twse_day), ("TPEx", tpex_day)):
            codes = [c for c, mk in stocks.items() if mk == market and (ignore_first or d >= first.get(c, "9999"))]
            if not codes:
                continue
            data = fn(d)
            for c in codes:
                if c in data and data[c]["close"] is not None:
                    rows.append({"stock_code": c, "trade_date": d, **data[c]})
            time.sleep(DELAY)
        if rows:
            db.upsert("stock_prices", rows, "stock_code,trade_date")
        total += len(rows)
        done.add(d)
        if not ignore_first:
            prog["stock"] = sorted(done)
            save_progress(prog)
        print(f"[stock] {d} {len(rows)} 筆", flush=True)
    print(f"[stock] 完成，共寫入 {total} 筆")


# ---------- 每月轉換資料：公開資訊觀測站「轉換公司債轉換變動情形一覽表」 ----------

def parse_conv_html(content: bytes, month: str):
    text = content.decode("cp950", errors="replace")
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", text, re.S):
        if "<th" in tr:
            continue
        tds = [re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", x)).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(tds) != 7:
            continue
        stock = tds[0].split(" ", 1)
        cb = tds[1].split(" ", 1)
        if not re.fullmatch(r"\d{4,6}", cb[0]):
            continue
        reset = None
        m = re.fullmatch(r"(\d{2,3})/(\d{2})/(\d{2})", tds[5])
        if m:
            reset = f"{int(m.group(1)) + 1911}-{m.group(2)}-{m.group(3)}"
        rows.append({
            "cb_code": cb[0], "month": month, "cb_name": cb[1] if len(cb) > 1 else None,
            "stock_code": stock[0], "stock_name": stock[1] if len(stock) > 1 else None,
            "bought_back_lots": num(tds[2]), "converted_lots": num(tds[3]),
            "conversion_price": num(tds[4]), "reset_date": reset, "shares_converted": num(tds[6]),
        })
    return rows


def run_conv(db, since: date, until: date):
    y, m = max(since.year, 2020), since.month if since.year >= 2020 else 12
    total = 0
    while (y, m) <= (until.year, until.month):
        ym = f"{y}{m:02d}"
        try:
            r = requests.get(f"https://mopsov.twse.com.tw/nas/t120/CBTRN{ym}.htm", headers=HDR, timeout=60)
        except requests.RequestException:
            r = None
        if r is not None and r.status_code == 200:
            rows = parse_conv_html(r.content, f"{y}-{m:02d}-01")
            if rows:
                db.upsert("cb_conversions", rows, "cb_code,month")
            total += len(rows)
            print(f"[conv] {y}-{m:02d} {len(rows)} 筆", flush=True)
        else:
            print(f"[conv] {y}-{m:02d} 尚未公布", flush=True)
        time.sleep(0.5)
        m += 1
        if m == 13:
            y, m = y + 1, 1
    print(f"[conv] 完成，共寫入 {total} 筆")


EXPORT_COLUMNS = {
    "cb_prices": [("cb_code", "CB代碼"), ("cb_name", "CB名稱"), ("trade_date", "日期"), ("mode", "交易模式"),
                  ("open", "開盤"), ("high", "最高"), ("low", "最低"), ("close", "收盤"), ("change", "漲跌"),
                  ("pct", "漲跌幅%"), ("trades", "成交筆數"), ("volume", "成交量(張)"),
                  ("amount", "成交金額(元)"), ("avg_price", "均價")],
    "stock_prices": [("stock_code", "股票代碼"), ("trade_date", "日期"), ("open", "開盤"), ("high", "最高"),
                     ("low", "最低"), ("close", "收盤"), ("change", "漲跌"), ("pct", "漲跌幅%"),
                     ("trades", "成交筆數"), ("volume", "成交量(張)"), ("amount", "成交金額(元)")],
    "cb_conversions": [("cb_code", "CB代碼"), ("cb_name", "CB名稱"), ("stock_code", "母股代碼"),
                       ("stock_name", "母股名稱"), ("month", "月份(月底)"), ("total_lots", "總張數"),
                       ("bought_back_lots", "本月買回張數"), ("converted_lots", "本月轉換張數"),
                       ("cum_converted", "累計轉換張數"), ("shares_converted", "本月轉換股數"),
                       ("remain_ratio", "剩餘比率%"), ("conversion_price", "轉換價格(元)"),
                       ("reset_date", "轉換價生效日(最近重設日)")],
}
EXPORT_ORDER = {
    "cb_prices": "cb_code.asc,trade_date.asc,mode.asc",
    "stock_prices": "stock_code.asc,trade_date.asc",
    "cb_conversions": "cb_code.asc,month.asc",
}


def derive_export_row(table: str, r: dict) -> dict:
    """匯出格式：漲跌空白補 0、加漲跌幅%、母股成交量由股改張（不足 1 張捨去）、轉換月份顯示 YYYY-MM。"""
    r = dict(r)
    if table in ("cb_prices", "stock_prices"):
        close, change = r.get("close"), r.get("change")
        if change is None and close is not None:
            change = 0
        r["change"] = change
        prev = close - change if close is not None and change is not None else None
        r["pct"] = round(change / prev * 100, 2) if prev and prev > 0 else None
        if table == "stock_prices" and r.get("volume") is not None:
            r["volume"] = int(r["volume"] // 1000)
    if table == "cb_conversions":
        import calendar

        y, m = int(str(r["month"])[:4]), int(str(r["month"])[5:7])
        r["month"] = f"{y}-{m:02d}-{calendar.monthrange(y, m)[1]:02d}"
    return r


def prepare_conversions(rows: list, db) -> list:
    """總張數＝發行總額(億)×1000；累計轉換＝逐月累加；剩餘比率＝(總張數−累計轉換)/總張數。已下線債券無總額則留空。"""
    total = {b["cb_code"]: round(b["circulation"] * 1000) for b in db.select("bonds", "cb_code,circulation") if b["circulation"]}
    cum = {}
    for r in sorted(rows, key=lambda x: (x["cb_code"], x["month"])):
        c = cum.get(r["cb_code"], 0) + (r.get("converted_lots") or 0)
        cum[r["cb_code"]] = c
        t = total.get(r["cb_code"])
        r["total_lots"] = t
        r["cum_converted"] = c
        r["remain_ratio"] = round((t - c) / t * 100, 2) if t else None
    return sorted(rows, key=lambda x: (x["cb_code"], x["month"]))


def write_export_csv(path, table: str, rows: list):
    import csv

    cols = EXPORT_COLUMNS[table]
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, lineterminator="\r\n")
        w.writerow([h for _, h in cols])
        for raw in rows:
            r = derive_export_row(table, raw)
            w.writerow(["" if r.get(k) is None else (int(r[k]) if isinstance(r[k], float) and r[k] == int(r[k]) else r[k]) for k, _ in cols])


def export_all(db):
    """把三張表完整匯出成 CSV 存到本機 price_archive/（本機備份，和資料庫各存一份）。"""
    out_dir = Path(__file__).parent / "price_archive"
    out_dir.mkdir(exist_ok=True)
    stamp = date.today().isoformat()
    for table, order in EXPORT_ORDER.items():
        rows = db.select(table, "*", order=order)
        path = out_dir / f"{table}_{stamp}.csv"
        if table == "cb_conversions":
            rows = prepare_conversions(rows, db)
        write_export_csv(path, table, rows)
        print(f"[export] {path} {len(rows)} 筆")


def main():
    kind = sys.argv[1] if len(sys.argv) > 1 else "all"
    if kind == "export":
        export_all(Db())
        return
    since = date.fromisoformat(sys.argv[2]) if len(sys.argv) > 2 else date.today() - timedelta(days=14)
    until = date.today()
    db = Db()
    if len(sys.argv) <= 2:
        PROGRESS.write_text(json.dumps({"cb": [], "stock": []}), encoding="utf-8")  # 每日補漏：近 14 天一律重寫
    if kind in ("cb", "all"):
        run_cb(db, since, until)
    if kind in ("stock", "all"):
        run_stock(db, since, until)
    if kind in ("conv", "all"):
        run_conv(db, since if len(sys.argv) > 2 else date.today() - timedelta(days=100), until)


if __name__ == "__main__":
    main()
