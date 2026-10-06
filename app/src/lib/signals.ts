import type { CBRow } from "./types";

export interface Condition {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

const MIN_AMOUNT_20D = 3_000_000; // 近 20 日均成交金額門檻（元）

function n2(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toLocaleString("zh-TW", { maximumFractionDigits: 2 });
}

// 買進候選條件：每符合一項給一顆星（共 5 項）
//   轉換溢價率 <= 10%；現股價格 >= 轉換價 × 0.9；可轉債價格 <= 115；
//   近 20 日均成交金額 >= 300 萬元；股價 > 20MA > 60MA
export function evalConditions(row: CBRow): Condition[] {
  const cb = row.cbQuote?.price ?? row.convertible_bond_market_price ?? null;
  const stock = row.stockQuote?.price ?? null;
  const cp = row.conversion_price;
  const sig = row.signal;

  const premium =
    cb !== null && stock !== null && cp !== null && cp > 0 ? (cb / ((stock / cp) * 100) - 1) * 100 : row.premium_rate;

  return [
    {
      key: "premium",
      label: "轉換溢價率 ≤ 10%",
      ok: premium !== null && premium <= 10,
      detail: premium !== null ? `${n2(premium)}%` : "無資料",
    },
    {
      key: "stock_vs_cp",
      label: "現股價 ≥ 轉換價 × 0.9",
      ok: stock !== null && cp !== null && stock >= cp * 0.9,
      detail: stock !== null && cp !== null ? `${n2(stock)} / ${n2(cp * 0.9)}` : "無資料",
    },
    {
      key: "cb_price",
      label: "可轉債價格 ≤ 115",
      ok: cb !== null && cb <= 115,
      detail: cb !== null ? n2(cb) : "無資料",
    },
    {
      key: "amount",
      label: "近 20 日均成交金額 ≥ 300 萬",
      ok: sig?.avg_amount_20d != null && sig.avg_amount_20d >= MIN_AMOUNT_20D,
      detail: sig?.avg_amount_20d != null ? `${n2(sig.avg_amount_20d / 10000)} 萬` : "無資料",
    },
    {
      key: "trend",
      label: "股價 > 20MA > 60MA",
      ok: stock !== null && sig?.ma20 != null && sig?.ma60 != null && stock > sig.ma20 && sig.ma20 > sig.ma60,
      detail: sig?.ma20 != null && sig?.ma60 != null ? `${n2(stock)} / ${n2(sig.ma20)} / ${n2(sig.ma60)}` : "均線資料不足",
    },
  ];
}
