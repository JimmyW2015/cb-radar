import { useMemo, useState } from "react";
import { HistoryCard, STATUS_LABEL, historyStatus, type HistoryStatus } from "../components/HistoryCard";
import { ExportPanel } from "../components/ExportPanel";
import { hasGuarantee } from "../lib/bond";
import { useHistory } from "../lib/useHistory";

const PAGE_SIZE = 40;

export function HistoryPage({ liveCodes }: { liveCodes: Set<string> }) {
  const { rows, loading, error } = useHistory();
  const [search, setSearch] = useState("");
  const [year, setYear] = useState("");
  const [guarantee, setGuarantee] = useState<"all" | "guaranteed" | "unguaranteed">("all");
  const [status, setStatus] = useState<"all" | HistoryStatus>("delisted");
  const [shown, setShown] = useState(PAGE_SIZE);

  const withStatus = useMemo(() => rows.map((r) => ({ r, s: historyStatus(r, liveCodes) })), [rows, liveCodes]);
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.report_date?.slice(0, 4)).filter((x): x is string => !!x))].sort().reverse(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withStatus.filter(({ r, s }) => {
      if (!q && status !== "all" && s !== status) return false; // 有輸入搜尋時，各種狀態都顯示
      if (q && !r.company.toLowerCase().includes(q) && !(r.cb_code ?? "").includes(q) && !(r.stock_code ?? "").includes(q)) return false;
      if (year && r.report_date?.slice(0, 4) !== year) return false;
      const isGuaranteed = hasGuarantee(r.bond_type);
      if (guarantee === "guaranteed" && !isGuaranteed) return false;
      if (guarantee === "unguaranteed" && isGuaranteed) return false;
      return true;
    });
  }, [withStatus, search, year, guarantee, status]);

  const reset = () => setShown(PAGE_SIZE);

  return (
    <div className="list">
      <div className="panel-title">歷史資料</div>
      <div className="list-meta">
        <span>依承銷公告整理，「已下線」為推定（不在目前總表內），下線原因與日期暫無資料</span>
      </div>

      <ExportPanel />

      <div className="searchrow" style={{ marginTop: 4 }}>
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.6" y2="16.6" />
          </svg>
          <input
            placeholder="搜尋公司名稱／母股代號／CB 代碼"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              reset();
            }}
          />
        </div>
      </div>

      <div className="hist-filters">
        <select
          className="sort-select"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            reset();
          }}
        >
          <option value="all">狀態：全部</option>
          {(Object.keys(STATUS_LABEL) as HistoryStatus[]).map((k) => (
            <option key={k} value={k}>
              狀態：{STATUS_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          className="sort-select"
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            reset();
          }}
        >
          <option value="">年份：全部</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {Number(y) - 1911} 年
            </option>
          ))}
        </select>
        <select
          className="sort-select"
          value={guarantee}
          onChange={(e) => {
            setGuarantee(e.target.value as typeof guarantee);
            reset();
          }}
        >
          <option value="all">擔保：全部</option>
          <option value="guaranteed">有擔保</option>
          <option value="unguaranteed">無擔保</option>
        </select>
      </div>

      <div className="list-meta">
        <span>
          符合 {filtered.length} / {rows.length} 筆 · 依公告日由新到舊
        </span>
      </div>

      {loading && <div className="state-msg">載入中…</div>}
      {error && <div className="state-msg error">讀取失敗：{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="state-msg">沒有符合條件的歷史資料</div>}

      {filtered.slice(0, shown).map(({ r, s }) => (
        <HistoryCard key={r.case_no} row={r} status={s} />
      ))}

      {filtered.length > shown && (
        <div className="p-link" style={{ textAlign: "center", padding: 14 }} onClick={() => setShown(shown + PAGE_SIZE)}>
          顯示更多（還有 {filtered.length - shown} 筆）
        </div>
      )}
    </div>
  );
}
