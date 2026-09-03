import { useMemo, useState } from "react";
import { AuctionCard } from "../components/AuctionCard";
import { useSimpleTable } from "../lib/useSimpleTable";
import type { Auction } from "../lib/types";

interface AuctionFilterState {
  search: string;
  year: string; // "" = 全部
  month: string; // "" = 全部
  underwriter: string; // "" = 全部
  guarantee: "all" | "guaranteed" | "unguaranteed";
}

const defaultAuctionFilters: AuctionFilterState = {
  search: "",
  year: "",
  month: "",
  underwriter: "",
  guarantee: "all",
};

export function AuctionsPage() {
  const { rows, loading, error } = useSimpleTable<Auction>("auctions", { column: "report_date", ascending: false });
  const [filters, setFilters] = useState<AuctionFilterState>(defaultAuctionFilters);
  const [sheetOpen, setSheetOpen] = useState(false);

  const years = useMemo(
    () => [...new Set(rows.map((r) => r.report_date?.slice(0, 4)).filter((x): x is string => !!x))].sort().reverse(),
    [rows],
  );
  const underwriters = useMemo(
    () => [...new Set(rows.map((r) => r.underwriter).filter(Boolean))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return rows.filter((a) => {
      if (q && !a.company.toLowerCase().includes(q) && !(a.cb_code ?? "").includes(q)) return false;
      if (filters.year && a.report_date?.slice(0, 4) !== filters.year) return false;
      if (filters.month && String(Number(a.report_date?.slice(5, 7))) !== filters.month) return false;
      if (filters.underwriter && a.underwriter !== filters.underwriter) return false;
      const isGuaranteed = a.bond_type && !a.bond_type.includes("無");
      if (filters.guarantee === "guaranteed" && !isGuaranteed) return false;
      if (filters.guarantee === "unguaranteed" && isGuaranteed) return false;
      return true;
    });
  }, [rows, filters]);

  const activeCount =
    (filters.search ? 1 : 0) +
    (filters.year ? 1 : 0) +
    (filters.month ? 1 : 0) +
    (filters.underwriter ? 1 : 0) +
    (filters.guarantee !== "all" ? 1 : 0);

  return (
    <div className="list">
      <div className="panel-title">競拍／詢圈公告</div>

      <div className="searchrow" style={{ marginTop: 4 }}>
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.6" y2="16.6" />
          </svg>
          <input
            placeholder="搜尋股票代碼／公司名稱"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
        </div>
        <button className="filter-btn" onClick={() => setSheetOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="7" y1="12" x2="17" y2="12" />
            <line x1="10" y1="18" x2="14" y2="18" />
          </svg>
          篩選
          {activeCount > 0 && <span className="badge">{activeCount}</span>}
        </button>
      </div>

      <div className="list-meta">
        <span>符合 {filtered.length} / {rows.length} 筆 · 依申報日排序</span>
      </div>

      {loading && <div className="state-msg">載入中…</div>}
      {error && <div className="state-msg error">讀取失敗：{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="state-msg">沒有符合篩選條件的公告</div>}

      {filtered.map((a) => (
        <AuctionCard auction={a} key={a.case_no} />
      ))}

      <div className={`sheet-overlay ${sheetOpen ? "open" : ""}`} onClick={() => setSheetOpen(false)} />
      <div className={`sheet ${sheetOpen ? "open" : ""}`}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h3>篩選條件</h3>
          <span className="sheet-reset" onClick={() => setFilters(defaultAuctionFilters)}>
            清除全部
          </span>
        </div>
        <div className="sheet-body">
          <div className="f-group">
            <div className="f-title">年份</div>
            <div className="chips">
              <div className={`chip ${filters.year === "" ? "on" : ""}`} onClick={() => setFilters({ ...filters, year: "" })}>
                全部
              </div>
              {years.map((y) => (
                <div
                  key={y}
                  className={`chip ${filters.year === y ? "on" : ""}`}
                  onClick={() => setFilters({ ...filters, year: y })}
                >
                  {Number(y) - 1911} 年
                </div>
              ))}
            </div>
          </div>

          <div className="f-group">
            <div className="f-title">月份</div>
            <div className="chips">
              <div
                className={`chip ${filters.month === "" ? "on" : ""}`}
                onClick={() => setFilters({ ...filters, month: "" })}
              >
                全部
              </div>
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((m) => (
                <div
                  key={m}
                  className={`chip ${filters.month === m ? "on" : ""}`}
                  onClick={() => setFilters({ ...filters, month: m })}
                >
                  {m} 月
                </div>
              ))}
            </div>
          </div>

          <div className="f-group">
            <div className="f-title">擔保情形</div>
            <div className="chips">
              {(["all", "guaranteed", "unguaranteed"] as const).map((g) => (
                <div
                  key={g}
                  className={`chip ${filters.guarantee === g ? "on" : ""}`}
                  onClick={() => setFilters({ ...filters, guarantee: g })}
                >
                  {g === "all" ? "全部" : g === "guaranteed" ? "有擔保" : "無擔保"}
                </div>
              ))}
            </div>
          </div>

          <div className="f-group">
            <div className="f-title">主辦承銷商</div>
            <select
              className="sort-select"
              style={{ marginTop: 0 }}
              value={filters.underwriter}
              onChange={(e) => setFilters({ ...filters, underwriter: e.target.value })}
            >
              <option value="">全部</option>
              {underwriters.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sheet-foot">
          <div className="apply-btn" onClick={() => setSheetOpen(false)}>
            套用篩選 <span className="cnt">符合 {filtered.length} 筆</span>
          </div>
        </div>
      </div>
    </div>
  );
}
