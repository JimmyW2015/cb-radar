import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CBListPage, type SortKey } from "./pages/CBListPage";
import { PipelinePage } from "./pages/PipelinePage";
import { AuctionsPage } from "./pages/AuctionsPage";
import { WatchlistPage } from "./pages/WatchlistPage";
import { FilterSheet } from "./components/FilterSheet";
import { CBDetailSheet } from "./components/CBDetailSheet";
import { useCbData } from "./lib/useCbData";
import { useWatchlist } from "./lib/useWatchlist";
import { useSimpleTable } from "./lib/useSimpleTable";
import { applyFilters, defaultFilters, countActiveFilters, type FilterState } from "./lib/filters";
import { isMarketOpen, taipeiTimeString } from "./lib/marketStatus";
import type { BidStats, CBRow } from "./lib/types";

type Tab = "list" | "pipeline" | "auction" | "watch";

const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
  {
    key: "list",
    label: "總表",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="10" width="4" height="10" />
        <rect x="10" y="6" width="4" height="14" />
        <rect x="17" y="13" width="4" height="7" />
      </svg>
    ),
  },
  {
    key: "pipeline",
    label: "預計發行",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="6" r="2" />
        <circle cx="19" cy="18" r="2" />
        <path d="M7 12h3M14 7.2l3 8.6" />
      </svg>
    ),
  },
  {
    key: "auction",
    label: "競拍詢圈",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4h16v4l-6 6v6l-4-2v-4l-6-6z" />
      </svg>
    ),
  },
  {
    key: "watch",
    label: "自選",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 17.3l-6.2 3.3 1.2-6.9L2 8.9l7-1L12 1.5l3 6.4 7 1-5 4.8 1.2 6.9z" />
      </svg>
    ),
  },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "premium_asc", label: "溢折價率 低到高" },
  { key: "premium_desc", label: "溢折價率 高到低" },
  { key: "days_asc", label: "剩餘天數 少到多" },
  { key: "days_desc", label: "剩餘天數 多到少" },
  { key: "stock_change_desc", label: "母股漲跌排行（漲幅優先）" },
  { key: "stock_change_asc", label: "母股漲跌排行（跌幅優先）" },
  { key: "cb_change_desc", label: "CB漲跌排行（漲幅優先）" },
  { key: "cb_change_asc", label: "CB漲跌排行（跌幅優先）" },
  { key: "volume_desc", label: "CB成交量排行 高到低" },
  { key: "volume_asc", label: "CB成交量排行 低到高" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<SortKey>("premium_asc");
  const [selected, setSelected] = useState<CBRow | null>(null);
  const [now, setNow] = useState(new Date());

  const { rows, loading, error } = useCbData();
  const { watchSet, toggle } = useWatchlist();
  const { rows: bidStatsRows } = useSimpleTable<BidStats>("bid_stats");

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const selectedBidStats = useMemo(() => {
    if (!selected) return null;
    return bidStatsRows.find((b) => b.cb_code === selected.cb_code) ?? null;
  }, [selected, bidStatsRows]);

  const activeFilterCount = countActiveFilters(filters);
  const filteredCount = useMemo(() => applyFilters(rows, filters).length, [rows, filters]);
  const marketOpen = isMarketOpen(now);

  return (
    <div className="phone-app">
      <div className="topbar">
        <div className="topbar-row">
          <div className="brand">
            可轉債雷達
            <small>CB RADAR · CBAS / TPEx / TWSA</small>
          </div>
          <div className={`market-pill ${marketOpen ? "" : "closed"}`}>
            <span className="dot" />
            {marketOpen ? "盤中" : "休市"} {taipeiTimeString(now)}
          </div>
        </div>
        {tab === "list" && (
          <>
            <div className="searchrow">
              <div className="search">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.6" y2="16.6" />
                </svg>
                <input
                  placeholder="搜尋代碼／個股名稱"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button className="filter-btn" onClick={() => setFilterOpen(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="7" y1="12" x2="17" y2="12" />
                  <line x1="10" y1="18" x2="14" y2="18" />
                </svg>
                篩選
                {activeFilterCount > 0 && <span className="badge">{activeFilterCount}</span>}
              </button>
            </div>
            <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className="content">
        {tab === "list" && (
          <CBListPage
            rows={rows}
            loading={loading}
            error={error}
            search={search}
            filters={filters}
            watchSet={watchSet}
            onToggleWatch={toggle}
            onSelect={setSelected}
            sort={sort}
          />
        )}
        {tab === "pipeline" && <PipelinePage />}
        {tab === "auction" && <AuctionsPage />}
        {tab === "watch" && (
          <WatchlistPage rows={rows} watchSet={watchSet} onToggleWatch={toggle} onSelect={setSelected} />
        )}
      </div>

      <FilterSheet
        open={filterOpen}
        filters={filters}
        matchCount={filteredCount}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />
      <CBDetailSheet row={selected} bidStats={selectedBidStats} onClose={() => setSelected(null)} />

      <nav className="navbar">
        {TABS.map((t) => (
          <div key={t.key} className={`nav-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.icon}
            {t.label}
          </div>
        ))}
      </nav>
    </div>
  );
}
