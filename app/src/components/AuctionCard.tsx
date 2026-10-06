import { useState } from "react";
import { fmtDateROC, fmtNum } from "../lib/format";
import type { Auction, BidStats, PipelineRow } from "../lib/types";
import { BidReport } from "./BidReport";
import type { AuctionTimeline } from "../lib/timeline";

const METHOD_CLASS: Record<string, string> = {
  競價拍賣: "auction",
  詢價圈購: "inquiry",
};

interface Props {
  auction: Auction;
  bid?: BidStats | null;
  pipeline?: PipelineRow | null;
  timeline?: AuctionTimeline | null;
  tcri?: string | null;
}

export function AuctionCard({ auction, bid = null, pipeline = null, timeline = null, tcri = null }: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = bid !== null || auction.issue_price_pct !== null || auction.conversion_premium_pct !== null || auction.bid_opening_date !== null;
  const methodClass = METHOD_CLASS[auction.method ?? ""] ?? "";
  const done = auction.status === "撤銷";

  return (
    <div className={`a-card ${done ? "done" : ""}`}>
      <div className="a-top">
        <span className={`a-method ${methodClass}`}>{auction.method ?? "-"}</span>
        <span className="a-date">{fmtDateROC(auction.report_date)} 申報</span>
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
      {expanded && bid && (
        <div style={{ marginTop: 10 }}>
          <BidReport
            row={{
              cb_code: bid.cb_code,
              cb_name: bid.cb_name ?? auction.company,
              guarantee_situation: auction.bond_type?.includes("無") ? "無" : auction.bond_type ? "有" : null,
              tcri: (tcri ?? pipeline?.tcri ?? "").match(/\d/)?.[0] ?? null,
            }}
            bid={bid}
            auction={{ auction_lots: auction.auction_lots, timeline }}
            pipeline={pipeline}
          />
        </div>
      )}
      {expanded && !bid && (
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
              <span className="val">{fmtDateROC(auction.bid_opening_date)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
