import { fmtDateShort, fmtNum } from "../lib/format";
import type { PipelineRow } from "../lib/types";

export function PipelineCard({ row }: { row: PipelineRow }) {
  const isAuction = (row.inquiry_auction ?? "").includes("競拍");
  const badgeClass = isAuction ? "auction" : "inquiry";
  const badgeLabel = isAuction ? "競拍" : row.inquiry_auction?.includes("詢圈") ? "詢圈" : "未定";

  return (
    <div className="p-card">
      <div className="p-top">
        <div>
          <div className="p-name">{row.cb_name}</div>
          <div className="p-broker">
            {row.code ?? row.cb_code} · 主辦：{row.host_broker || "未定"}
          </div>
        </div>
        <span className={`p-badge ${badgeClass}`}>{badgeLabel}</span>
      </div>
      <div className="p-row">
        {row.stage === "board_announcement" && (
          <>
            <Metric label="發行規模" value={row.circulation !== null ? `${fmtNum(row.circulation, 1)} 億` : "-"} />
            <Metric label="年期" value={row.annual ?? "-"} />
            <Metric label="董事會公告日" value={fmtDateShort(row.announcement_day)} />
          </>
        )}
        {row.stage === "effective" && (
          <>
            <Metric label="詢圈/競拍時程" value={row.inquiry_auction ?? "-"} />
            <Metric label="暫估溢價率" value={row.premium_rate ?? "-"} />
            <Metric label="預計生效日" value={fmtDateShort(row.expected_effective_date)} />
          </>
        )}
        {row.stage === "recently_listed" && (
          <>
            <Metric label="轉換溢價率" value={row.premium_rate ? `${row.premium_rate}%` : "-"} />
            <Metric label="轉換價值" value={fmtNum(row.conversion_value)} />
            <Metric label="掛牌日" value={fmtDateShort(row.listing_day)} />
          </>
        )}
      </div>
      {row.remark && <div className="p-remark">{row.remark}</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
    </div>
  );
}
