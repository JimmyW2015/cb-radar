import { fmtDateROC, fmtNum, fmtPct } from "../lib/format";
import { changePct } from "../lib/quote";
import type { CBRow } from "../lib/types";

interface Props {
  row: CBRow;
  watched: boolean;
  onToggleWatch: (code: string) => void;
  onClick: () => void;
}

export function CBCard({ row, watched, onToggleWatch, onClick }: Props) {
  const price = row.cbQuote?.price ?? row.convertible_bond_market_price;
  const premium = row.premium_rate;
  const isGuaranteed = row.guarantee_situation && !row.guarantee_situation.includes("無");

  const stockChg = changePct(row.stockQuote);
  const cbChg = changePct(row.cbQuote);
  const cbVolume = row.cbQuote?.volume ?? null;

  return (
    <div className="card" onClick={onClick}>
      <div className="card-top">
        <div className="card-name">
          <div className="nm">{row.cb_name}</div>
          <div className="code-row">
            <span className="code-num">{row.cb_code}</span>
            <span className="premium-label">溢折價率</span>
            <span className={`premium-val ${premium !== null && premium < 0 ? "down" : "up"}`}>{fmtPct(premium)}</span>
          </div>
          <div className="tag-row">
            <span className={`tag ${isGuaranteed ? "guar" : "unguar"}`}>
              {isGuaranteed ? "有擔保" : "無擔保"}
            </span>
            {row.tcri && <span className="tag tcri">TCRI {row.tcri}</span>}
          </div>
        </div>
        <div className="card-right">
          <button
            className={`star-btn ${watched ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleWatch(row.cb_code);
            }}
            aria-label="加入自選"
          >
            {watched ? "★" : "☆"}
          </button>
          <div className="card-price">
            <div className="px">{fmtNum(price)}</div>
          </div>
        </div>
      </div>
      <div className="card-bottom">
        <div className="metric">
          <span className="lbl">轉換價</span>
          <span className="val">{fmtNum(row.conversion_price)}</span>
        </div>
        <div className="metric">
          <span className="lbl">母股現價</span>
          <span className="val">{fmtNum(row.stockQuote?.price ?? null)}</span>
        </div>
        <div className="metric">
          <span className="lbl">母股漲跌</span>
          <span className={`val ${!stockChg ? "" : stockChg < 0 ? "down" : "up"}`}>{fmtPct(stockChg)}</span>
        </div>
        <div className="metric">
          <span className="lbl">轉債漲跌</span>
          <span className={`val ${!cbChg ? "" : cbChg < 0 ? "down" : "up"}`}>{fmtPct(cbChg)}</span>
        </div>
        <div className="metric">
          <span className="lbl">轉債成交量</span>
          <span className="val">{cbVolume !== null ? `${fmtNum(cbVolume, 0)} 張` : "-"}</span>
        </div>
        <div className="metric">
          <span className="lbl">到期日</span>
          <span className="val">{fmtDateROC(row.expiry_date)}</span>
        </div>
        <div className="metric">
          <span className="lbl">餘額比率</span>
          <span className="val">{row.balance_ratio !== null ? `${fmtNum(row.balance_ratio, 1)}%` : "-"}</span>
        </div>
      </div>
    </div>
  );
}
