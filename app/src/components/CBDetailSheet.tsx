import { fmtDateROC, fmtNum, fmtPct } from "../lib/format";
import type { BidStats, CBRow } from "../lib/types";

interface Props {
  row: CBRow | null;
  bidStats: BidStats | null;
  onClose: () => void;
}

export function CBDetailSheet({ row, bidStats, onClose }: Props) {
  const open = row !== null;

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

              <div className="detail-section-title">開標統計結果</div>
              {bidStats ? (
                <>
                  <div className="detail-grid">
                    <DetailItem label="競拍方式" value={bidStats.auction_method ?? "-"} />
                    <DetailItem label="主辦承銷商" value={bidStats.underwriter ?? "-"} />
                    <DetailItem label="開標日期" value={fmtDateROC(bidStats.bid_opening_date)} />
                    <DetailItem label="最低承銷價格" value={fmtNum(bidStats.floor_price)} />
                    <DetailItem label="得標加權平均價格" value={fmtNum(bidStats.weighted_avg_price)} />
                    <DetailItem label="公開承銷價格" value={fmtNum(bidStats.issue_price)} />
                    <DetailItem label="最低／最高得標價格" value={`${fmtNum(bidStats.min_winning_price)} ／ ${fmtNum(bidStats.max_winning_price)}`} />
                    <DetailItem
                      label="合格投標 筆數／數量(仟股)"
                      value={`${bidStats.qualified_bid_count ?? "-"} ／ ${fmtNum(bidStats.qualified_bid_qty, 0)}`}
                    />
                    <DetailItem
                      label="得標 筆數／數量(仟股)"
                      value={`${bidStats.won_count ?? "-"} ／ ${fmtNum(bidStats.won_qty, 0)}`}
                    />
                    <DetailItem label="得標總金額(仟元)" value={fmtNum(bidStats.won_amount, 0)} />
                  </div>
                  {bidStats.price_ladder && bidStats.price_ladder.length > 0 && (
                    <PriceLadder ladder={bidStats.price_ladder} />
                  )}
                  {bidStats.report_pdf_url && (
                    <a className="pdf-link" href={bidStats.report_pdf_url} target="_blank" rel="noreferrer">
                      查看開標統計表原始 PDF ↗
                    </a>
                  )}
                </>
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

function DetailItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`detail-item ${full ? "full" : ""}`}>
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}

function PriceLadder({ ladder }: { ladder: NonNullable<BidStats["price_ladder"]> }) {
  const top = [...ladder].sort((a, b) => b.price - a.price).slice(0, 8);
  return (
    <div className="ladder">
      <div className="ladder-title">得標價位分布（前 8 高）</div>
      <div className="ladder-rows">
        {top.map((row) => (
          <div className="ladder-row" key={row.seq}>
            <span className="ladder-price">{fmtNum(row.price)}</span>
            <span className="ladder-qty">{fmtNum(row.qty, 0)} 仟股</span>
          </div>
        ))}
      </div>
    </div>
  );
}
