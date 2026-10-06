import { useEffect, useState } from "react";
import { fetchAllPages } from "../lib/fetchAllPages";
import { supabase } from "../lib/supabase";
import { fmtDateROC } from "../lib/format";
import {
  digestToMarkdown,
  downloadText,
  p2,
  pctText,
  volText,
  weekdayOf,
  type DigestCb,
  taipeiToday,
  type DigestRow,
  type DigestStock,
} from "../lib/digest";

function useDigests() {
  const [rows, setRows] = useState<DigestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllPages<DigestRow>((from, to) =>
      supabase
        .from("daily_digests")
        .select("digest_date,status,generated_at,data")
        .order("digest_date", { ascending: false })
        .range(from, to),
    )
      .then((all) => !cancelled && setRows(all))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { rows, loading, error };
}

export function DigestPage() {
  const { rows: loaded, loading, error } = useDigests();
  // 今天（平日）資料庫還沒有紀錄（18:30 排程前）時，在清單最上面補一張「尚未產出」說明卡，不混進真實資料
  const today = taipeiToday();
  const rows = loaded;
  const showPlaceholder =
    !loading && !error && today.dow >= 1 && today.dow <= 5 && !loaded.some((r) => r.digest_date === today.date);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [shown, setShown] = useState(30);

  function exportAll() {
    const real = rows.filter((r) => r.status !== "pending");
    const text = real.map((r) => digestToMarkdown(r)).join("\n---\n\n");
    downloadText(`CB日報_${real[real.length - 1]?.digest_date ?? ""}_至_${real[0]?.digest_date ?? ""}.md`, text);
  }

  return (
    <div className="list">
      <div className="panel-title">每日盯市日報</div>
      <div className="list-meta">
        <span>依日期由新到舊，點日期展開內容；內容由官方盤後資料自動產生，每個營業日 18:30 更新</span>
      </div>

      <div className="export-panel">
        <div className="export-title">日報匯出（Markdown，格式同每日盯市摘要）</div>
        <div className="export-row">
          <button className="export-btn" onClick={exportAll} disabled={rows.length === 0}>
            匯出全部日報（{rows.filter((r) => r.status === "ok").length} 天有內容）
          </button>
        </div>
      </div>

      {loading && <div className="state-msg">載入中…</div>}
      {error && <div className="state-msg error">讀取失敗：{error}</div>}
      {!loading && !error && rows.length === 0 && <div className="state-msg">還沒有日報</div>}

      {showPlaceholder && (
        <div className="a-card digest pending">
          <div className="digest-head">
            <div>
              <div className="digest-date">
                {fmtDateROC(today.date)}（{weekdayOf(today.date)}）<span className="h-status pending">尚未產出</span>
              </div>
              <div className="digest-sub">日報尚未產出，預計約 18:30 產出</div>
            </div>
          </div>
        </div>
      )}

      {rows.slice(0, shown).map((r) => (
        <DigestItem key={r.digest_date} row={r} open={openDate === r.digest_date} onToggle={() => setOpenDate(openDate === r.digest_date ? null : r.digest_date)} />
      ))}

      {rows.length > shown && (
        <div className="p-link" style={{ textAlign: "center", padding: 14 }} onClick={() => setShown(shown + 30)}>
          顯示更多（還有 {rows.length - shown} 天）
        </div>
      )}
    </div>
  );
}

function headline(r: DigestRow): string {
  if (r.status === "pending") return "日報尚未產出，預計約 18:30 產出";
  if (r.status === "closed") return "休市（當日無行情）";
  const top = r.data.top_cb?.[0];
  const n = r.data.alerts?.length ?? 0;
  return `${top ? `CB 量冠 ${top.name} ${top.volume} 張` : "—"} · 提醒 ${n} 則`;
}

function DigestItem({ row, open, onToggle }: { row: DigestRow; open: boolean; onToggle: () => void }) {
  const d = row.data;
  return (
    <div className={`a-card digest ${row.status} ${open ? "open" : ""}`}>
      <div className="digest-head" onClick={onToggle}>
        <div>
          <div className="digest-date">
            {fmtDateROC(row.digest_date)}（{weekdayOf(row.digest_date)}）
            <span className={`h-status ${row.status === "ok" ? "live" : row.status === "pending" ? "pending" : ""}`}>
              {row.status === "ok" ? "已收盤" : row.status === "pending" ? "尚未產出" : "休市"}
            </span>
          </div>
          <div className="digest-sub">{headline(row)}</div>
        </div>
        <span className="digest-caret">{open ? "▴" : "▾"}</span>
      </div>

      {open && row.status !== "ok" && <div className="detail-empty digest-note">{d.note}</div>}

      {open && row.status === "ok" && (
        <div className="digest-body">
          <Section title="資料時間與覆蓋率">
            <ul className="digest-list">
              <li>資料日期：{d.date}（收盤後，台北時間）</li>
              <li>
                覆蓋：CB {d.cb_ok}/{d.cb_total} 檔有等價成交（{(d.cb_total ?? 0) - (d.cb_ok ?? 0)} 檔當日無等價成交，無法計價）；標的 {d.stock_ok}/{d.stock_total} 檔；可算溢價 {d.premium_ok} 檔
              </li>
              <li className="faint">{d.source}</li>
            </ul>
          </Section>

          <Section title="今日 CB 成交量前 15 名">
            <CbTable rows={d.top_cb ?? []} />
          </Section>

          <Section title="標的量能前 10 名">
            <StockTable rows={d.top_stock ?? []} withVolume />
          </Section>

          <Section title="相對昨收波動大的標的">
            <p className="digest-p">
              <b>漲幅</b>：{lineOf(d.movers_up)}
            </p>
            <p className="digest-p">
              <b>跌幅</b>：{lineOf(d.movers_down)}
            </p>
          </Section>

          <Section title="接近平價（溢價率 ±0.5% 內）且今日有量">
            <CbTable rows={d.near_parity ?? []} />
            {(d.small_discount ?? []).length > 0 && (
              <p className="digest-p">
                另有小折價有量：
                {(d.small_discount ?? []).map((c) => `${c.code} ${c.name} ${pctText(c.premium)}（${c.volume}張）`).join("、")}
              </p>
            )}
          </Section>

          {d.resets && (
            <Section title="近期重設（CBAS「即將重設」）">
              {d.resets.length === 0 ? (
                <p className="digest-p faint">近期無資料</p>
              ) : (
                <table className="bidrpt-table digest-table">
                  <thead>
                    <tr>
                      <th>重設日</th>
                      <th>券名</th>
                      <th>重設價</th>
                      <th>轉換價</th>
                      <th>標的現價</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.resets.map((r) => (
                      <tr key={r.code}>
                        <td>{r.reset_day.slice(5).replace("-", "/")}</td>
                        <td>{r.name}</td>
                        <td>{r.reset_price ?? "—"}</td>
                        <td>{r.conversion_price ?? "—"}</td>
                        <td>{p2(r.stock_close)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}

          <Section title="競拍券追蹤（近 45 日開標）">
            {(d.auctions ?? []).length === 0 ? (
              <p className="digest-p faint">近 45 日無競拍券</p>
            ) : (
              <table className="bidrpt-table digest-table">
                <thead>
                  <tr>
                    <th>券名</th>
                    <th>今日收</th>
                    <th>量</th>
                    <th>最低得標</th>
                    <th>加權均價</th>
                    <th>對照</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.auctions ?? []).map((a) => (
                    <tr key={a.code}>
                      <td>{a.name}</td>
                      <td>{p2(a.close)}</td>
                      <td>{a.volume ?? "—"}</td>
                      <td>{p2(a.min_winning_price)}</td>
                      <td>{p2(a.weighted_avg_price)}</td>
                      <td className={a.note.includes("跌破") ? "up" : ""}>{a.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="一句過熱／異常提醒">
            {(d.alerts ?? []).length === 0 ? (
              <p className="digest-p">今日無特別異常。</p>
            ) : (
              <ul className="digest-list">
                {(d.alerts ?? []).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </Section>

          <button
            className="export-btn"
            onClick={() => downloadText(`cb-daily-digest-${row.digest_date.replaceAll("-", "")}.md`, digestToMarkdown(row))}
          >
            匯出這一天（.md）
          </button>
        </div>
      )}
    </div>
  );
}

function lineOf(arr: DigestStock[] | undefined): string {
  return (arr ?? []).map((s) => `${s.code} ${s.name} ${pctText(s.pct)}`).join("、") || "無";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="digest-sec">
      <h4>{title}</h4>
      {children}
    </div>
  );
}

function CbTable({ rows }: { rows: DigestCb[] }) {
  if (rows.length === 0) return <p className="digest-p faint">無</p>;
  return (
    <table className="bidrpt-table digest-table">
      <thead>
        <tr>
          <th>代號 名稱</th>
          <th>現價</th>
          <th>量(張)</th>
          <th>溢價率</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.code}>
            <td>
              {c.code} {c.name}
            </td>
            <td>{p2(c.close)}</td>
            <td>{volText(c)}</td>
            <td className={c.premium != null && c.premium > 25 ? "up" : ""}>{pctText(c.premium)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StockTable({ rows, withVolume }: { rows: DigestStock[]; withVolume?: boolean }) {
  if (rows.length === 0) return <p className="digest-p faint">無</p>;
  return (
    <table className="bidrpt-table digest-table">
      <thead>
        <tr>
          <th>代號 名稱</th>
          <th>現價</th>
          {withVolume && <th>量(張)</th>}
          <th>漲跌幅</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => (
          <tr key={s.code}>
            <td>
              {s.code} {s.name}
            </td>
            <td>{p2(s.close)}</td>
            {withVolume && <td>{s.volume}</td>}
            <td className={s.pct != null && s.pct > 0 ? "up" : s.pct != null && s.pct < 0 ? "dn" : ""}>{pctText(s.pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
