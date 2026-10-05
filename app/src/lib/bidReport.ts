import type { BidStats, PriceLadderEntry } from "./types";

export interface Footprint extends PriceLadderEntry {
  share: number; // 占總得標量
  premium: number | null; // 相對競拍截止日轉換價值的溢價率
  amountYi: number; // 成交金額（億元）
}

export interface BidAnalysis {
  ladder: PriceLadderEntry[]; // 不含極端值，價格由低到高
  outliers: PriceLadderEntry[];
  total: number;
  convValue: number | null;
  demandRatio: number | null;
  band: { low: number; high: number } | null;
  top3Share: number;
  footprints: Footprint[];
  instQualifiedShare: number | null;
  instWonShare: number | null;
}

const BAND_SHARE = 0.3;

export function analyzeBid(b: BidStats, auctionLots: number | null): BidAnalysis | null {
  const all = [...(b.price_ladder ?? [])].sort((x, y) => x.price - y.price);
  if (all.length === 0) return null;

  const total = all.reduce((s, e) => s + e.qty, 0);
  const avg = b.weighted_avg_price ?? all.reduce((s, e) => s + e.price * e.qty, 0) / total;
  let ladder = all.filter((e) => e.price <= avg * 1.1);
  if (ladder.length > 2) {
    const top = ladder[ladder.length - 1];
    const next = ladder[ladder.length - 2];
    if (top.qty / total < 0.005 && top.price - next.price > 1) ladder = ladder.slice(0, -1);
  }
  if (ladder.length === 0) ladder = all;
  const kept = new Set(ladder.map((e) => e.seq));
  const outliers = all.filter((e) => !kept.has(e.seq));

  const convValue =
    b.stock_close && b.conversion_price ? (b.stock_close / b.conversion_price) * 100 : null;
  const lots = auctionLots ?? b.won_qty;
  const demandRatio = b.qualified_bid_qty && lots ? b.qualified_bid_qty / lots : null;

  let band: BidAnalysis["band"] = null;
  let bestSpan = Infinity;
  let bestQty = 0;
  for (let i = 0; i < ladder.length; i++) {
    let sum = 0;
    for (let j = i; j < ladder.length; j++) {
      sum += ladder[j].qty;
      if (sum / total >= BAND_SHARE) {
        const span = ladder[j].price - ladder[i].price;
        if (span < bestSpan || (span === bestSpan && sum > bestQty)) {
          bestSpan = span;
          bestQty = sum;
          band = { low: ladder[i].price, high: ladder[j].price };
        }
        break;
      }
    }
  }

  const byQty = [...ladder].sort((x, y) => y.qty - x.qty);
  const top3Share = byQty.slice(0, 3).reduce((s, e) => s + e.qty, 0) / total;
  const footprints: Footprint[] = byQty
    .slice(0, 10)
    .sort((x, y) => y.price - x.price)
    .map((e) => ({
      ...e,
      share: e.qty / total,
      premium: convValue ? e.price / convValue - 1 : null,
      amountYi: (e.price * e.qty * 1000) / 1e8,
    }));

  return {
    ladder,
    outliers,
    total,
    convValue,
    demandRatio,
    band,
    top3Share,
    footprints,
    instQualifiedShare:
      b.inst_qualified_qty != null && b.qualified_bid_qty ? b.inst_qualified_qty / b.qualified_bid_qty : null,
    instWonShare: b.inst_won_qty != null && b.won_qty ? b.inst_won_qty / b.won_qty : null,
  };
}
