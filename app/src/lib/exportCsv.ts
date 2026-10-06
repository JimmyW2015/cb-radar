import { downloadText } from "./download";
import { fetchAllPages } from "./fetchAllPages";
import { supabase } from "./supabase";

export interface ExportSpec {
  table: "cb_prices" | "stock_prices" | "cb_conversions";
  columns: [string, string, boolean?][]; // [欄位, 表頭, 是否為匯出時計算出的欄位]
  orderBy: string[];
  eq?: [string, string];
  dateCol?: string;
  start?: [number, number]; // 資料起始 [年, 月]，用於按月分塊讀取
  derive?: (r: Row) => Row;
  prepare?: (rows: Row[]) => Promise<Row[]>; // 讀完所有列、排序後，匯出前的整批加工（例如累計欄位）
  filename: string;
}

type Row = Record<string, unknown>;

// 漲跌空白視為 0；漲跌幅% = 漲跌 / 前一日收盤 × 100
function withChange(r: Row): Row {
  const close = r.close === null || r.close === undefined ? null : Number(r.close);
  const change = r.change === null || r.change === undefined ? (close === null ? null : 0) : Number(r.change);
  const prev = close !== null && change !== null ? close - change : null;
  const pct = prev !== null && prev > 0 && change !== null ? Math.round((change / prev) * 10000) / 100 : null;
  return { ...r, change, pct };
}

export const CB_EXPORT: Pick<ExportSpec, "table" | "columns" | "orderBy" | "derive"> = {
  table: "cb_prices",
  derive: withChange,
  columns: [
    ["cb_code", "CB代碼"],
    ["cb_name", "CB名稱"],
    ["trade_date", "日期"],
    ["mode", "交易模式"],
    ["open", "開盤"],
    ["high", "最高"],
    ["low", "最低"],
    ["close", "收盤"],
    ["change", "漲跌"],
    ["pct", "漲跌幅%", true],
    ["trades", "成交筆數"],
    ["volume", "成交量(張)"],
    ["amount", "成交金額(元)"],
    ["avg_price", "均價"],
  ],
  orderBy: ["cb_code", "trade_date", "mode"],
};

export const STOCK_EXPORT: Pick<ExportSpec, "table" | "columns" | "orderBy" | "derive"> = {
  table: "stock_prices",
  derive: (r) => {
    const v = withChange(r);
    // 股 → 張（1 張 = 1000 股），不足 1 張捨去
    return { ...v, volume: v.volume === null || v.volume === undefined ? null : Math.floor(Number(v.volume) / 1000) };
  },
  columns: [
    ["stock_code", "股票代碼"],
    ["trade_date", "日期"],
    ["open", "開盤"],
    ["high", "最高"],
    ["low", "最低"],
    ["close", "收盤"],
    ["change", "漲跌"],
    ["pct", "漲跌幅%", true],
    ["trades", "成交筆數"],
    ["volume", "成交量(張)"],
    ["amount", "成交金額(元)"],
  ],
  orderBy: ["stock_code", "trade_date"],
};

function monthEnd(month: string): string {
  const [y, m] = month.slice(0, 7).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

// 總張數 ＝ 現行債券的發行總額（億元）×1000；累計轉換張數 ＝ 該債逐月「本月轉換張數」累加；
// 剩餘比率 ＝ (總張數 − 累計轉換張數) ÷ 總張數。已下線債券沒有發行總額，總張數與剩餘比率留空。
async function prepareConversions(rows: Row[]): Promise<Row[]> {
  const { data } = await supabase.from("bonds").select("cb_code,circulation");
  const total = new Map<string, number>();
  for (const b of (data ?? []) as { cb_code: string; circulation: number | null }[]) {
    if (b.circulation) total.set(b.cb_code, Math.round(b.circulation * 1000));
  }
  const cum = new Map<string, number>();
  for (const r of rows) {
    const code = String(r.cb_code);
    const c = (cum.get(code) ?? 0) + Number(r.converted_lots ?? 0);
    cum.set(code, c);
    const t = total.get(code) ?? null;
    r.total_lots = t;
    r.cum_converted = c;
    r.remain_ratio = t ? Math.round(((t - c) / t) * 10000) / 100 : null;
  }
  return rows;
}

export const CONV_EXPORT: Pick<ExportSpec, "table" | "columns" | "orderBy" | "dateCol" | "start" | "derive" | "prepare"> = {
  table: "cb_conversions",
  dateCol: "month",
  start: [2020, 12],
  prepare: prepareConversions,
  derive: (r) => ({ ...r, month: monthEnd(String(r.month ?? "")) }),
  columns: [
    ["cb_code", "CB代碼"],
    ["cb_name", "CB名稱"],
    ["stock_code", "母股代碼"],
    ["stock_name", "母股名稱"],
    ["month", "月份(月底)"],
    ["total_lots", "總張數", true],
    ["bought_back_lots", "本月買回張數"],
    ["converted_lots", "本月轉換張數"],
    ["cum_converted", "累計轉換張數", true],
    ["shares_converted", "本月轉換股數"],
    ["remain_ratio", "剩餘比率%", true],
    ["conversion_price", "轉換價格(元)"],
    ["reset_date", "轉換價生效日(最近重設日)"],
  ],
  orderBy: ["cb_code", "month"],
};

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fetchRange(spec: ExportSpec, select: string, gte?: string, lt?: string): Promise<Row[]> {
  const dateCol = spec.dateCol ?? "trade_date";
  return fetchAllPages<Row>((from, to) => {
    let q = supabase.from(spec.table).select(select);
    if (spec.eq) q = q.eq(spec.eq[0], spec.eq[1]);
    if (gte) q = q.gte(dateCol, gte);
    if (lt) q = q.lt(dateCol, lt);
    for (const col of spec.orderBy) q = q.order(col, { ascending: true });
    return q.range(from, to);
  });
}

function monthRanges(start: [number, number] = [2021, 8]): [string, string][] {
  const out: [string, string][] = [];
  const now = new Date();
  let [y, m] = start;
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  while (new Date(y, m - 1, 1) < end) {
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    out.push([`${y}-${String(m).padStart(2, "0")}-01`, `${ny}-${String(nm).padStart(2, "0")}-01`]);
    y = ny;
    m = nm;
  }
  return out;
}

// 以月份切塊、平行讀取：避免單一深層分頁查詢超過資料庫的語句逾時
export async function exportCsv(spec: ExportSpec, onProgress?: (rows: number) => void): Promise<number> {
  const select = spec.columns.filter(([, , d]) => !d).map(([c]) => c).join(",");
  const all: Row[] = [];
  if (spec.eq) {
    all.push(...(await fetchRange(spec, select)));
  } else {
    const ranges = monthRanges(spec.start);
    const CONCURRENCY = 6;
    for (let i = 0; i < ranges.length; i += CONCURRENCY) {
      const results = await Promise.all(ranges.slice(i, i + CONCURRENCY).map(([g, l]) => fetchRange(spec, select, g, l)));
      for (const rows of results) all.push(...rows);
      onProgress?.(all.length);
    }
  }
  onProgress?.(all.length);

  const keyOf = (r: Row) => spec.orderBy.map((c) => String(r[c] ?? ""));
  const sorted = all
    .map((r) => [keyOf(r), r] as const)
    .sort(([kx], [ky]) => {
      for (let i = 0; i < kx.length; i++) if (kx[i] !== ky[i]) return kx[i] < ky[i] ? -1 : 1;
      return 0;
    })
    .map(([, r]) => r);

  const finalRows = spec.prepare ? await spec.prepare(sorted) : sorted;
  const lines = [spec.columns.map(([, h]) => csvCell(h)).join(",")];
  for (const raw of finalRows) {
    const r = spec.derive ? spec.derive(raw) : raw;
    lines.push(spec.columns.map(([c]) => csvCell(r[c])).join(","));
  }
  downloadText(spec.filename, lines.join("\r\n"), "text/csv");
  return lines.length - 1;
}
