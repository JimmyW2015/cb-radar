import { analyzeBid } from "../lib/bidReport";
import { hasGuarantee } from "../lib/bond";
import { fmtDateROC, fmtNum } from "../lib/format";
import type { AuctionTimelineRow } from "../lib/timeline";
import type { BidStats, PipelineRow } from "../lib/types";

export interface BidReportRow {
  cb_code: string;
  cb_name: string;
  guarantee_situation: string | null;
  tcri: string | null;
}

interface Props {
  row: BidReportRow;
  bid: BidStats;
  auction: Pick<AuctionTimelineRow, "auction_lots" | "timeline"> | null;
  pipeline: Pick<PipelineRow, "listing_day" | "dismantling_day"> | null;
}

type Analysis = NonNullable<ReturnType<typeof analyzeBid>>;

const W = 340;
const H = 176;
const PAD_X = 12;
const BASE_Y = 150;
const TOP_Y = 26;

export function BidReport({ row, bid, auction, pipeline }: Props) {
  const lots = auction?.auction_lots ?? null;
  const a = analyzeBid(bid, lots);
  const guarantee = !row.guarantee_situation ? "CB" : hasGuarantee(row.guarantee_situation) ? "有擔保CB" : "無擔保CB";
  const listing = pipeline?.listing_day ?? auction?.timeline?.listing_date_planned ?? null;
  const yi = bid.won_amount != null ? bid.won_amount / 1e5 : null;
  const maxFootQty = a ? Math.max(...a.footprints.map((x) => x.qty)) : 0;

  return (
    <div className="bidrpt">
      <div>
        <div className="bidrpt-title">
          {row.cb_code} <b>{row.cb_name}競拍結果</b>
          {bid.underwriter && <span>{bid.underwriter}主辦</span>}
        </div>
        <div className="bidrpt-sub">
          {guarantee} · TCRI {row.tcri ?? "-"} · 上櫃日 {fmtDateROC(listing)}
          {pipeline?.dismantling_day && <> · 拆解日 {fmtDateROC(pipeline.dismantling_day)}</>}
        </div>
      </div>

      <div className="bidrpt-card">
        <div className="bidrpt-cardhead">
          <h4>開標摘要</h4>
          <span>競拍結束日 {fmtDateROC(bid.bid_close_date ?? bid.bid_opening_date)}</span>
        </div>
        <div className="bidrpt-kpis">
          <Kpi label="競拍數量" value={lots ?? bid.won_qty} unit="張" />
          <Kpi label="合格投標" value={bid.qualified_bid_qty} unit="張" />
          <Kpi label="需求倍數" value={a?.demandRatio ?? null} unit="倍" digits={2} />
          <Kpi label="得標張數" value={bid.won_qty} unit="張" />
          <Kpi label="加權均價" value={bid.weighted_avg_price} digits={2} tone="up" />
          <Kpi label="最低得標價" value={bid.min_winning_price} digits={2} tone="down" />
          <Kpi label="最高得標價" value={bid.max_winning_price} digits={2} tone="up" />
          <Kpi label="得標總金額" value={yi} unit="億" digits={1} tone="gold" />
        </div>
      </div>

      {a ? (
        <>
          <div className="bidrpt-card">
            <div className="bidrpt-cardhead">
              <h4>得標價位分布</h4>
              {a.convValue != null && <span>競拍截止日轉換價值 {fmtNum(a.convValue)}</span>}
            </div>
            <Lollipop a={a} avg={bid.weighted_avg_price} />
            <div className="bidrpt-legend">
              <span>
                <i className="dn" />
                均價以下
              </span>
              <span>
                <i className="up" />
                均價以上
              </span>
              <span>
                <i className="band" />
                主要成交價帶
              </span>
            </div>
            {a.band && (
              <div className="bidrpt-note">
                主要成交價帶 {fmtNum(a.band.low)}–{fmtNum(a.band.high)}（至少 30% 得標張數） ｜ 前 3 價位占{" "}
                {(a.top3Share * 100).toFixed(1)}%
              </div>
            )}
            {a.outliers.length > 0 && (
              <div className="bidrpt-note faint">
                最高價 {fmtNum(Math.max(...a.outliers.map((o) => o.price)))} 等 {a.outliers.length} 個價位為極端值（高於均價 10%
                以上），未納入圖表與關鍵足跡
              </div>
            )}
          </div>

          <div className="bidrpt-card">
            <div className="bidrpt-cardhead">
              <h4>關鍵足跡</h4>
              <span>依價格由高至低</span>
            </div>
            <table className="bidrpt-table">
              <thead>
                <tr>
                  <th>價位</th>
                  <th>溢價率</th>
                  <th>得標張數</th>
                  <th>成交金額</th>
                  <th>占總量</th>
                </tr>
              </thead>
              <tbody>
                {a.footprints.map((f) => {
                  const top = f.qty === maxFootQty;
                  return (
                    <tr key={f.seq} className={top ? "hot" : ""}>
                      <td>
                        <i className={top ? "dot gold" : "dot"} />
                        {fmtNum(f.price)}
                      </td>
                      <td className="up">
                        {f.premium != null ? `${f.premium >= 0 ? "+" : ""}${(f.premium * 100).toFixed(1)}%` : "-"}
                      </td>
                      <td>{fmtNum(f.qty, 0)} 張</td>
                      <td>{f.amountYi.toFixed(2)} 億</td>
                      <td>{(f.share * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {a.instQualifiedShare != null && (
            <div className="bidrpt-card">
              <div className="bidrpt-cardhead">
                <h4>法人足跡</h4>
                <span>投標意願與最後得標分開看</span>
              </div>
              <div className="bidrpt-inst">
                <Donut share={a.instQualifiedShare} />
                <div className="bidrpt-bars">
                  <Bar
                    label="法人合格投標"
                    num={bid.inst_qualified_qty}
                    den={bid.qualified_bid_qty}
                    share={a.instQualifiedShare}
                    tone="gold"
                  />
                  <Bar label="法人得標" num={bid.inst_won_qty} den={bid.won_qty} share={a.instWonShare} tone="up" />
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="detail-empty">這檔沒有可解析的得標價位明細</div>
      )}

      {bid.report_pdf_url && (
        <a className="pdf-link" href={bid.report_pdf_url} target="_blank" rel="noreferrer">
          查看開標統計表原始 PDF ↗
        </a>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  unit,
  digits = 0,
  tone,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  digits?: number;
  tone?: "up" | "down" | "gold";
}) {
  return (
    <div className="kpi">
      <span className="lbl">{label}</span>
      <span className={`val ${tone ?? ""}`}>
        {value == null ? "-" : fmtNum(value, digits)}
        {value != null && unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

function Bar({
  label,
  num,
  den,
  share,
  tone,
}: {
  label: string;
  num: number | null;
  den: number | null;
  share: number | null;
  tone: "gold" | "up";
}) {
  return (
    <div className="ibar">
      <div className="ibar-top">
        <span>{label}</span>
        <b className={tone}>{share != null ? `${(share * 100).toFixed(1)}%` : "-"}</b>
      </div>
      <div className="ibar-num">
        {fmtNum(num, 0)} / {fmtNum(den, 0)}
      </div>
      <div className="ibar-track">
        <div className={`ibar-fill ${tone}`} style={{ width: `${Math.min(100, (share ?? 0) * 100)}%` }} />
      </div>
    </div>
  );
}

function Donut({ share }: { share: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <svg className="donut" viewBox="0 0 100 100" role="img" aria-label={`法人合格投標 ${(share * 100).toFixed(1)}%`}>
      <circle cx="50" cy="50" r={r} className="donut-bg" />
      <circle
        cx="50"
        cy="50"
        r={r}
        className="donut-fg"
        strokeDasharray={`${c * share} ${c}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="49" textAnchor="middle" className="donut-num">
        {(share * 100).toFixed(1)}%
      </text>
      <text x="50" y="64" textAnchor="middle" className="donut-lbl">
        法人合格投標
      </text>
    </svg>
  );
}

function Lollipop({ a, avg }: { a: Analysis; avg: number | null }) {
  const prices = a.ladder.map((e) => e.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const x = (p: number) => PAD_X + ((p - lo) / span) * (W - PAD_X * 2);
  const maxQty = Math.max(...a.ladder.map((e) => e.qty));
  const h = (q: number) => 6 + Math.sqrt(q / maxQty) * (BASE_Y - TOP_Y - 6);
  const labeled: typeof a.ladder = [];
  for (const e of [...a.ladder].sort((p, q) => q.qty - p.qty)) {
    if (labeled.length < 4 && labeled.every((l) => Math.abs(x(l.price) - x(e.price)) > 30)) labeled.push(e);
  }

  return (
    <svg className="lolli" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="得標價位分布">
      {a.band && (
        <rect
          className="lolli-band"
          x={x(a.band.low) - 8}
          y={TOP_Y - 6}
          width={Math.max(16, x(a.band.high) - x(a.band.low) + 16)}
          height={BASE_Y - TOP_Y + 6}
          rx="4"
        />
      )}
      <line className="lolli-axis" x1={PAD_X} x2={W - PAD_X} y1={BASE_Y} y2={BASE_Y} />
      {a.ladder.map((e) => {
        const below = avg != null ? e.price <= avg : true;
        const cx = x(e.price);
        const cy = BASE_Y - h(e.qty);
        return (
          <g key={e.seq} className={below ? "lolli-dn" : "lolli-up"}>
            <line x1={cx} x2={cx} y1={BASE_Y} y2={cy} />
            <circle cx={cx} cy={cy} r={2 + 5 * Math.sqrt(e.qty / maxQty)} />
          </g>
        );
      })}
      {avg != null && avg >= lo && avg <= hi && (
        <g>
          <line className="lolli-avg" x1={x(avg)} x2={x(avg)} y1={14} y2={BASE_Y} />
          <text className="lolli-avgtxt" x={x(avg) + 4} y={12}>
            均價 {fmtNum(avg)}
          </text>
        </g>
      )}
      {labeled.map((e, i) => {
        const cx = Math.min(W - 22, Math.max(22, x(e.price)));
        const cy = Math.max(26, BASE_Y - h(e.qty) - 12 - (i % 2) * 12);
        return (
          <text key={e.seq} className="lolli-lbl" x={cx} y={cy} textAnchor="middle">
            {fmtNum(e.price)}
          </text>
        );
      })}
      <text className="lolli-tick" x={PAD_X} y={H - 6}>
        {fmtNum(lo)}
      </text>
      <text className="lolli-tick" x={W - PAD_X} y={H - 6} textAnchor="end">
        {fmtNum(hi)}
      </text>
    </svg>
  );
}
