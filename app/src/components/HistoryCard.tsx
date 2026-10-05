import { useState } from "react";
import { fmtDateROC, fmtNum } from "../lib/format";
import type { HistoryRow } from "../lib/useHistory";

export type HistoryStatus = "live" | "pending" | "delisted" | "cancelled";

export const STATUS_LABEL: Record<HistoryStatus, string> = {
  live: "流通中",
  pending: "狀態待確認",
  delisted: "已下線（推定）",
  cancelled: "撤銷案",
};

const ORDINALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五"];

export function historyStatus(r: HistoryRow, today = new Date()): HistoryStatus {
  if (r.cb_code) return "live";
  if (r.status === "撤銷") return "cancelled";
  const reported = r.report_date ? new Date(r.report_date) : null;
  const ageDays = reported ? (today.getTime() - reported.getTime()) / 86_400_000 : Infinity;
  // 未連到現行債券：近一年內的案子可能只是還沒對上，不貿然說已下線
  return ageDays < 365 ? "pending" : "delisted";
}

export function HistoryCard({ row, status }: { row: HistoryRow; status: HistoryStatus }) {
  const [open, setOpen] = useState(false);
  const t = row.timeline ?? {};
  const ord = t.ordinal && !/第.+次/.test(row.company) ? `第${ORDINALS[t.ordinal] ?? t.ordinal}次` : "";
  const events: [string, string | null | undefined][] = [
    ["承銷公告", row.report_date],
    ["訂定轉換價格基準日", t.pricing_base_date],
    [t.inquiry_date ? "詢價圈購完成" : "競價拍賣開標", t.inquiry_date ?? row.bid_opening_date],
    ["未得標保證金退款", t.refund_date],
    ["繳款截止（扣款）", row.payment_deadline ?? t.deduction_date ?? t.inquiry_payment_date],
    ["掛牌上櫃／上市（預定）", t.listing_date_planned],
  ];

  return (
    <div className={`a-card hist ${status}`}>
      <div className="a-top">
        <span className={`h-status ${status}`}>{STATUS_LABEL[status]}</span>
        <span className="a-date">{fmtDateROC(row.report_date)} 公告</span>
      </div>
      <div className="a-name">
        {row.company} {ord}
        {row.company.includes("公司債") ? "" : row.bond_type}
      </div>
      <div className="a-sub">
        {row.method ?? "-"} · 主辦：{row.underwriter}
        {row.cb_code && <> · {row.cb_code}</>}
      </div>
      <div className="a-row">
        <div className="metric">
          <span className="lbl">轉換價</span>
          <span className="val">{fmtNum(row.conversion_price)}</span>
        </div>
        <div className="metric">
          <span className="lbl">轉換溢價率</span>
          <span className="val">{row.conversion_premium_pct != null ? `${fmtNum(row.conversion_premium_pct)}%` : "-"}</span>
        </div>
        <div className="metric">
          <span className="lbl">掛牌日</span>
          <span className="val">{fmtDateROC(t.listing_date_planned)}</span>
        </div>
      </div>
      <div className="p-link" onClick={() => setOpen((v) => !v)}>
        {open ? "收合發行時間軸 ▴" : "查看發行時間軸 →"}
      </div>
      {open && (
        <>
          <ol className="timeline">
            {events
              .filter(([, d]) => d)
              .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
              .map(([label, d]) => (
                <li key={label}>
                  <span className="tl-date">{fmtDateROC(d)}</span>
                  <span className="tl-label">{label}</span>
                </li>
              ))}
          </ol>
          {row.pdf_url && (
            <a className="pdf-link" href={row.pdf_url} target="_blank" rel="noreferrer">
              查看承銷公告原始 PDF ↗
            </a>
          )}
        </>
      )}
    </div>
  );
}
