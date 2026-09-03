import { DualRange } from "./DualRange";
import {
  BALANCE_RATIO_BOUNDS,
  DAYS_BOUNDS,
  MARKET_VALUE_BOUNDS,
  PREMIUM_BOUNDS,
  defaultFilters,
  type FilterState,
} from "../lib/filters";

interface Props {
  open: boolean;
  filters: FilterState;
  matchCount: number;
  onChange: (f: FilterState) => void;
  onClose: () => void;
}

type TcriTier = "1-3" | "4-6" | "7-9" | "none";
const TCRI_LABELS: [TcriTier, string][] = [
  ["1-3", "1–3 級"],
  ["4-6", "4–6 級"],
  ["7-9", "7–9 級"],
  ["none", "未評等"],
];

export function FilterSheet({ open, filters, matchCount, onChange, onClose }: Props) {
  function toggleTcri(tier: "1-3" | "4-6" | "7-9" | "none") {
    const next = new Set(filters.tcriTiers);
    if (next.has(tier)) next.delete(tier);
    else next.add(tier);
    onChange({ ...filters, tcriTiers: next });
  }

  return (
    <>
      <div className={`sheet-overlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h3>篩選條件</h3>
          <span className="sheet-reset" onClick={() => onChange(defaultFilters)}>
            清除全部
          </span>
        </div>
        <div className="sheet-body">
          <div className="f-group">
            <div className="f-title">快速篩選</div>
            <div className="chips">
              <div
                className={`chip ${filters.nearMaturity ? "on" : ""}`}
                onClick={() => onChange({ ...filters, nearMaturity: !filters.nearMaturity })}
              >
                快到期（3個月內）
              </div>
              <div
                className={`chip ${filters.recentlyIssued ? "on" : ""}`}
                onClick={() => onChange({ ...filters, recentlyIssued: !filters.recentlyIssued })}
              >
                剛發行（7日內）
              </div>
              <div
                className={`chip ${filters.nearParity ? "on" : ""}`}
                onClick={() => onChange({ ...filters, nearParity: !filters.nearParity })}
              >
                轉換價值接近百元
              </div>
              <div
                className={`chip ${filters.listedDay1to6 ? "on" : ""}`}
                onClick={() => onChange({ ...filters, listedDay1to6: !filters.listedDay1to6 })}
              >
                上市第1–6天
              </div>
            </div>
          </div>

          <div className="f-group">
            <div className="f-title">擔保情形</div>
            <div className="chips">
              {(["all", "guaranteed", "unguaranteed"] as const).map((g) => (
                <div
                  key={g}
                  className={`chip ${filters.guarantee === g ? "on" : ""}`}
                  onClick={() => onChange({ ...filters, guarantee: g })}
                >
                  {g === "all" ? "全部" : g === "guaranteed" ? "有擔保" : "無擔保"}
                </div>
              ))}
            </div>
          </div>

          <div className="f-group">
            <div className="f-title">
              TCRI 信用評等<span className="f-hint">數字越大風險越高</span>
            </div>
            <div className="chips">
              {TCRI_LABELS.map(([tier, label]) => (
                <div
                  key={tier}
                  className={`chip ${filters.tcriTiers.has(tier) ? "on" : ""}`}
                  onClick={() => toggleTcri(tier)}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          <div className="f-group">
            <div className="f-title">
              溢（折）價率<span className="f-hint">%</span>
            </div>
            <DualRange
              min={PREMIUM_BOUNDS[0]}
              max={PREMIUM_BOUNDS[1]}
              step={1}
              value={filters.premiumRange}
              onChange={(v) => onChange({ ...filters, premiumRange: v })}
              formatLabel={(n) => `${n > 0 ? "+" : ""}${n}%`}
            />
          </div>

          <div className="f-group">
            <div className="f-title">
              剩餘天數<span className="f-hint">天</span>
            </div>
            <DualRange
              min={DAYS_BOUNDS[0]}
              max={DAYS_BOUNDS[1]}
              step={10}
              value={filters.daysRange}
              onChange={(v) => onChange({ ...filters, daysRange: v })}
              formatLabel={(n) => `${n} 天`}
            />
          </div>

          <div className="f-group">
            <div className="f-title">
              市值範圍<span className="f-hint">新台幣・億元</span>
            </div>
            <DualRange
              min={MARKET_VALUE_BOUNDS[0]}
              max={MARKET_VALUE_BOUNDS[1]}
              step={1}
              value={filters.marketValueRange}
              onChange={(v) => onChange({ ...filters, marketValueRange: v })}
              formatLabel={(n) => `${n} 億`}
            />
          </div>

          <div className="f-group">
            <div className="f-title">
              餘額比率<span className="f-hint">流通性・越高代表未轉換比例越多</span>
            </div>
            <DualRange
              min={BALANCE_RATIO_BOUNDS[0]}
              max={BALANCE_RATIO_BOUNDS[1]}
              step={1}
              value={filters.balanceRatioRange}
              onChange={(v) => onChange({ ...filters, balanceRatioRange: v })}
              formatLabel={(n) => `${n}%`}
            />
          </div>
        </div>
        <div className="sheet-foot">
          <div className="apply-btn" onClick={onClose}>
            套用篩選 <span className="cnt">符合 {matchCount} 檔</span>
          </div>
        </div>
      </div>
    </>
  );
}
