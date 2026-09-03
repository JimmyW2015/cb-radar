import { useState } from "react";
import { fmtDate, fmtNum } from "../lib/format";
import type { Auction } from "../lib/types";

const METHOD_CLASS: Record<string, string> = {
  競價拍賣: "auction",
  詢價圈購: "inquiry",
};

export function AuctionCard({ auction }: { auction: Auction }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = auction.issue_price_pct !== null || auction.conversion_premium_pct !== null || auction.bid_opening_date !== null;
  const methodClass = METHOD_CLASS[auction.method ?? ""] ?? "";
  const done = auction.status === "撤銷";

  return (
    <div className={`a-card ${done ? "done" : ""}`}>
      <div className="a-top">
        <span className={`a-method ${methodClass}`}>{auction.method ?? "-"}</span>
        <span className="a-date">{fmtDate(auction.report_date)} 申報</span>
      </div>
      <div className="a-name">
        {auction.company} — {auction.bond_type}
      </div>
      <div className="a-sub">主辦：{auction.underwriter}</div>
      <div className="a-row">
        <div className="metric">
          <span className="lbl">案件狀態</span>
          <span className="val">{auction.status ?? "-"}</span>
        </div>
        {auction.conversion_premium_pct !== null && (
          <div className="metric">
            <span className="lbl">轉換溢價率</span>
            <span className="val">{fmtNum(auction.conversion_premium_pct)}%</span>
          </div>
        )}
      </div>
      {hasResult && (
        <div className="p-link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收合開標統計結果 ▴" : "查看開標統計結果 →"}
        </div>
      )}
      {expanded && (
        <div className="a-row" style={{ marginTop: 4 }}>
          {auction.issue_price_pct !== null && (
            <div className="metric">
              <span className="lbl">發行價格</span>
              <span className="val">{fmtNum(auction.issue_price_pct)}</span>
            </div>
          )}
          {auction.auction_lots !== null && (
            <div className="metric">
              <span className="lbl">競拍張數</span>
              <span className="val">{fmtNum(auction.auction_lots, 0)}</span>
            </div>
          )}
          {auction.bid_opening_date !== null && (
            <div className="metric">
              <span className="lbl">開標日期</span>
              <span className="val">{fmtDate(auction.bid_opening_date)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
