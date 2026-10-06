import { fmtDateROC, fmtNum, fmtPct } from "../lib/format";
import { BidReport } from "./BidReport";
import { taipeiToday } from "../lib/digest";
import { evalConditions } from "../lib/signals";
import { ExportButton } from "./ExportButton";
import { CB_EXPORT, CONV_EXPORT, STOCK_EXPORT } from "../lib/exportCsv";
import type { BidStats, CBRow, PipelineRow } from "../lib/types";
import { buildTimeline, type AuctionTimelineRow } from "../lib/timeline";

interface Props {
  row: CBRow | null;
  bidStats: BidStats | null;
  auction: AuctionTimelineRow | null;
  pipeline: PipelineRow | null;
  onClose: () => void;
}

export function CBDetailSheet({ row, bidStats, auction, pipeline, onClose }: Props) {
  const open = row !== null;
  const conds = row ? evalConditions(row) : [];

  return (
    <>
      <div className={`sheet-overlay ${open ? "open" : ""}`} onClick={onClose} />
      <div className={`sheet detail-sheet ${open ? "open" : ""}`}>
        <div className="sheet-handle" />
        {row && (
          <>
            <div className="sheet-head">
              <div>
                <h3>{row.cb_name}</h3>
                <div className="detail-sub">
                  {row.cb_code} · 母股 {row.stock_code ?? "-"}
                </div>
              </div>
              <span className="sheet-reset" onClick={onClose}>
                關閉
              </span>
            </div>
            <div className="sheet-body">
              <div className="detail-grid">
                <DetailItem label="可轉債現價" value={fmtNum(row.cbQuote?.price ?? row.convertible_bond_market_price)} />
                <DetailItem label="溢（折）價率" value={fmtPct(row.premium_rate)} />
                <DetailItem label="轉換價值" value={fmtNum(row.conversion_value)} />
                <DetailItem label="轉換價格" value={fmtNum(row.conversion_price)} />
                <DetailItem label="母股現價" value={fmtNum(row.stockQuote?.price ?? null)} />
                <DetailItem label="TCRI" value={row.tcri ?? "-"} />
                <DetailItem label="擔保情形" value={row.guarantee_situation ?? "-"} />
                <DetailItem label="發行日" value={fmtDateROC(row.issue_date)} />
                <DetailItem label="到期日" value={fmtDateROC(row.expiry_date)} />
                <DetailItem label="剩餘天數" value={row.remaining_days !== null ? `${row.remaining_days} 天` : "-"} />
                <DetailItem label="餘額比率" value={row.balance_ratio !== null ? `${fmtNum(row.balance_ratio, 1)}%` : "-"} />
                <DetailItem label="市值(億)" value={fmtNum(row.market_value, 2)} />
                <DetailItem label="最新賣回日" value={fmtDateROC(row.latest_sale_date)} />
                <DetailItem label="賣回價" value={fmtNum(row.latest_sale_price)} />
                <DetailItem label="賣回殖利率" value={row.sell_back_yield !== null ? `${fmtNum(row.sell_back_yield)}%` : "-"} />
                <DetailItem label="停止轉換期間" value={row.stop_conversion_date ? `${fmtDateROC(row.stop_conversion_date)} ~ ${fmtDateROC(row.stop_converting_until_date)}` : "-"} />
                {row.reset_conversion_price && row.reset_conversion_price.trim() && (
                  <DetailItem label="重設狀態" value={row.reset_conversion_price} />
                )}
              </div>

              <div className="detail-section-title">
                買進條件檢查（{conds.filter((c) => c.ok).length}/{conds.length}）
              </div>
              <ul className="cond-list">
                {conds.map((c) => (
                  <li key={c.key} className={c.ok ? "ok" : "no"}>
                    <span className="mark">{c.ok ? "✓" : "✗"}</span>
                    <span className="lbl">{c.label}</span>
                    <span className="det">{c.detail}</span>
                  </li>
                ))}
              </ul>

              <div className="detail-section-title">歷史行情匯出</div>
              <div className="export-row">
                <ExportButton
                  label="匯出 CB 日K（CSV）"
                  spec={{ ...CB_EXPORT, eq: ["cb_code", row.cb_code], filename: `${row.cb_code}_${row.cb_name}_日K.csv` }}
                />
                <ExportButton
                  label="匯出每月轉換資料（CSV）"
                  spec={{ ...CONV_EXPORT, eq: ["cb_code", row.cb_code], filename: `${row.cb_code}_${row.cb_name}_每月轉換.csv` }}
                />
                {row.stock_code && (
                  <ExportButton
                    label="匯出母股日K（CSV）"
                    spec={{ ...STOCK_EXPORT, eq: ["stock_code", row.stock_code], filename: `${row.stock_code}_母股日K.csv` }}
                  />
                )}
              </div>

              <div className="detail-section-title">發行時間軸</div>
              <Timeline events={buildTimeline(row, auction, pipeline)} />

              <div className="detail-section-title">開標統計結果</div>
              {bidStats ? (
                <BidReport row={row} bid={bidStats} auction={auction} pipeline={pipeline} />
              ) : (
                <div className="detail-empty">尚未查到這檔的開標統計資料（可能未經競價拍賣，或尚未開標）</div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Timeline({ events }: { events: ReturnType<typeof buildTimeline> }) {
  const today = taipeiToday().date;
  if (events.length === 0) return <div className="detail-empty">尚無可整理的日期資料</div>;
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={`${e.date}-${e.label}`} className={e.date > today ? "future" : ""}>
          <span className="tl-date">{fmtDateROC(e.date)}</span>
          <span className="tl-label">
            {e.label}
            {e.note && <small>{e.note}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function DetailItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`detail-item ${full ? "full" : ""}`}>
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}
