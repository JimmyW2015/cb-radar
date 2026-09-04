import type { CBRow } from "./types";

export type ConversionValueTier = "under50" | "50-80" | "80-150" | "above150" | "none";

export interface FilterState {
  guarantee: "all" | "guaranteed" | "unguaranteed";
  tcriTiers: Set<"1-3" | "4-6" | "7-9" | "none">;
  conversionValueTiers: Set<ConversionValueTier>;
  premiumRange: [number, number];
  daysRange: [number, number];
  marketValueRange: [number, number];
  balanceRatioRange: [number, number];
  nearMaturity: boolean; // 快到期（三個月內到期）
  recentlyIssued: boolean; // 剛發行（7日內發行）
  recentlyListed: boolean; // 上市3個月內
  nearParity: boolean; // 轉換價值接近百元
}

export const NEAR_MATURITY_DAYS = 90;
export const RECENTLY_ISSUED_DAYS = 7;
export const RECENTLY_LISTED_DAYS = 90;
export const NEAR_PARITY_BAND = 5; // conversion_value within 100 ± 5

function daysSinceIssue(issueDate: string): number {
  return Math.round((Date.now() - new Date(issueDate).getTime()) / 86_400_000);
}

export const PREMIUM_BOUNDS: [number, number] = [-80, 250];
export const DAYS_BOUNDS: [number, number] = [0, 2000];
export const MARKET_VALUE_BOUNDS: [number, number] = [0, 150];
export const BALANCE_RATIO_BOUNDS: [number, number] = [0, 100];

export const defaultFilters: FilterState = {
  guarantee: "all",
  tcriTiers: new Set(["1-3", "4-6", "7-9", "none"]),
  conversionValueTiers: new Set(["under50", "50-80", "80-150", "above150", "none"]),
  premiumRange: PREMIUM_BOUNDS,
  daysRange: DAYS_BOUNDS,
  marketValueRange: MARKET_VALUE_BOUNDS,
  balanceRatioRange: BALANCE_RATIO_BOUNDS,
  nearMaturity: false,
  recentlyIssued: false,
  recentlyListed: false,
  nearParity: false,
};

function tcriTier(tcri: string | null): "1-3" | "4-6" | "7-9" | "none" {
  const n = tcri ? Number(tcri) : NaN;
  if (Number.isNaN(n)) return "none";
  if (n <= 3) return "1-3";
  if (n <= 6) return "4-6";
  return "7-9";
}

function conversionValueTier(cv: number | null): ConversionValueTier {
  if (cv === null) return "none";
  if (cv < 50) return "under50";
  if (cv < 80) return "50-80";
  if (cv < 150) return "80-150";
  return "above150";
}

export function applyFilters(rows: CBRow[], f: FilterState): CBRow[] {
  return rows.filter((r) => {
    if (f.guarantee === "guaranteed" && (!r.guarantee_situation || r.guarantee_situation.includes("無"))) return false;
    if (f.guarantee === "unguaranteed" && r.guarantee_situation && !r.guarantee_situation.includes("無")) return false;

    if (!f.tcriTiers.has(tcriTier(r.tcri))) return false;
    if (!f.conversionValueTiers.has(conversionValueTier(r.conversion_value))) return false;

    if (r.premium_rate !== null) {
      if (r.premium_rate < f.premiumRange[0] || r.premium_rate > f.premiumRange[1]) return false;
    }
    if (r.remaining_days !== null) {
      if (r.remaining_days < f.daysRange[0] || r.remaining_days > f.daysRange[1]) return false;
    }
    if (r.market_value !== null) {
      if (r.market_value < f.marketValueRange[0] || r.market_value > f.marketValueRange[1]) return false;
    }
    if (r.balance_ratio !== null) {
      if (r.balance_ratio < f.balanceRatioRange[0] || r.balance_ratio > f.balanceRatioRange[1]) return false;
    }

    if (f.nearMaturity) {
      if (r.remaining_days === null || r.remaining_days < 0 || r.remaining_days > NEAR_MATURITY_DAYS) return false;
    }
    if (f.recentlyIssued) {
      if (!r.issue_date || daysSinceIssue(r.issue_date) < 0 || daysSinceIssue(r.issue_date) > RECENTLY_ISSUED_DAYS) return false;
    }
    if (f.recentlyListed) {
      if (!r.issue_date || daysSinceIssue(r.issue_date) < 0 || daysSinceIssue(r.issue_date) > RECENTLY_LISTED_DAYS) return false;
    }
    if (f.nearParity) {
      if (r.conversion_value === null || Math.abs(r.conversion_value - 100) > NEAR_PARITY_BAND) return false;
    }

    return true;
  });
}

export function countActiveFilters(f: FilterState): number {
  let n = 0;
  if (f.guarantee !== "all") n++;
  if (f.tcriTiers.size < 4) n++;
  if (f.conversionValueTiers.size < 5) n++;
  if (f.premiumRange[0] !== PREMIUM_BOUNDS[0] || f.premiumRange[1] !== PREMIUM_BOUNDS[1]) n++;
  if (f.daysRange[0] !== DAYS_BOUNDS[0] || f.daysRange[1] !== DAYS_BOUNDS[1]) n++;
  if (f.marketValueRange[0] !== MARKET_VALUE_BOUNDS[0] || f.marketValueRange[1] !== MARKET_VALUE_BOUNDS[1]) n++;
  if (f.balanceRatioRange[0] !== BALANCE_RATIO_BOUNDS[0] || f.balanceRatioRange[1] !== BALANCE_RATIO_BOUNDS[1]) n++;
  if (f.nearMaturity) n++;
  if (f.recentlyIssued) n++;
  if (f.recentlyListed) n++;
  if (f.nearParity) n++;
  return n;
}
