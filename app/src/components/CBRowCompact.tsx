import { fmtNum, fmtPct } from "../lib/format";
import { changeAmt, changePct } from "../lib/quote";
import { evalConditions } from "../lib/signals";
import type { CBRow } from "../lib/types";

interface Props {
  row: CBRow;
  watched: boolean;
  onToggleWatch: (code: string) => void;
  onClick: () => void;
}

export function CBRowCompact({ row, watched, onToggleWatch, onClick }: Props) {
  const quote = row.cbQuote;
  const price = quote?.price ?? row.convertible_bond_market_price;
  const amt = changeAmt(quote);
  const pct = changePct(quote);
  const dir = amt === null || amt === 0 ? "flat" : amt > 0 ? "up" : "down";
  const premium = row.premium_rate;
  const parity = row.conversion_value;
  const converted = row.balance_ratio !== null ? Math.max(0, 100 - row.balance_ratio) : null;
  const conds = evalConditions(row);
  const n = conds.filter((c) => c.ok).length;
  const starTip = conds.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}（${c.detail}）`).join("\n");

  // 條狀圖＝五檔委託量：紅＝委買量、綠＝委賣量（沒有委託資料時留灰）
  const bidQty = quote?.bid_qty ?? 0;
  const askQty = quote?.ask_qty ?? 0;
  const book = bidQty + askQty;
  const greenPct = book > 0 ? (askQty / book) * 100 : null;

  return (
    <div className="crow" onClick={onClick}>
      <div className="crow-top">
        <div className="crow-name">
          <b>{row.cb_name}</b>
          <span className="crow-code">{row.cb_code}</span>
        </div>
        <div className="crow-right">
          {n > 0 && (
            <span className="crow-stars" title={starTip}>
              {"★".repeat(n)}
            </span>
          )}
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
        </div>
      </div>

      <div className={`crow-price ${dir}`}>
        <span className="px">{price !== null && price !== undefined ? fmtNum(price) : "--"}</span>
        {amt !== null && (
          <span className="chg">
            {amt > 0 ? "+" : ""}
            {fmtNum(amt)} ({fmtPct(pct)})
          </span>
        )}
        <span className="arrow">{dir === "up" ? "▲" : dir === "down" ? "▼" : "−"}</span>
      </div>

      <div className="crow-line">
        <span>
          <i>轉換價值</i> <em className="gold">{fmtNum(parity)}</em>
        </span>
        <span>
          <i>量</i> <em>{quote?.volume != null ? fmtNum(quote.volume, 0) : "-"}</em>
        </span>
        <span>
          <i>五日均量</i> <em>{row.avg_volume_5d != null ? fmtNum(row.avg_volume_5d) : "-"}</em>
        </span>
      </div>

      <div className="crow-bar" title={greenPct !== null ? `五檔委託量：委買 ${fmtNum(bidQty, 0)}／委賣 ${fmtNum(askQty, 0)}` : "目前沒有委託資料"}>
        {greenPct !== null ? (
          <>
            <div className="g" style={{ width: `${greenPct}%` }} />
            <div className="r" style={{ width: `${100 - greenPct}%` }} />
          </>
        ) : (
          <div className="n" />
        )}
      </div>

      <div className="crow-line">
        <span>
          <i>轉換比例</i> <em>{converted !== null ? `${fmtNum(converted)}%` : "-"}</em>
        </span>
        <span>
          <i>轉換溢價率</i> <em className={premium !== null && premium < 0 ? "down" : ""}>{premium !== null ? `${fmtNum(premium)}%` : "-"}</em>
        </span>
        <span>
          <i>剩餘天數</i> <em className="accent">{row.remaining_days ?? "-"}</em>
        </span>
      </div>
    </div>
  );
}
