import { useMemo, useState } from "react";
import { CBCard } from "../components/CBCard";
import { CBRowCompact } from "../components/CBRowCompact";
import { usePersistedState } from "../lib/usePersistedState";
import { applyFilters, type FilterState } from "../lib/filters";
import { changePct } from "../lib/quote";
import type { CBRow } from "../lib/types";

interface Props {
  rows: CBRow[];
  loading: boolean;
  error: string | null;
  search: string;
  filters: FilterState;
  watchSet: Set<string>;
  onToggleWatch: (code: string) => void;
  onSelect: (row: CBRow) => void;
  sort: SortKey;
}

export type SortKey =
  | "premium_asc"
  | "premium_desc"
  | "days_asc"
  | "days_desc"
  | "volume_desc"
  | "volume_asc"
  | "stock_change_desc"
  | "stock_change_asc"
  | "cb_change_desc"
  | "cb_change_asc";

export function sortRows(rows: CBRow[], sort: SortKey): CBRow[] {
  const copy = [...rows];
  switch (sort) {
    case "premium_asc":
      return copy.sort((a, b) => (a.premium_rate ?? Infinity) - (b.premium_rate ?? Infinity));
    case "premium_desc":
      return copy.sort((a, b) => (b.premium_rate ?? -Infinity) - (a.premium_rate ?? -Infinity));
    case "days_asc":
      return copy.sort((a, b) => (a.remaining_days ?? Infinity) - (b.remaining_days ?? Infinity));
    case "days_desc":
      return copy.sort((a, b) => (b.remaining_days ?? -Infinity) - (a.remaining_days ?? -Infinity));
    case "volume_desc":
      return copy.sort((a, b) => (b.cbQuote?.volume ?? -Infinity) - (a.cbQuote?.volume ?? -Infinity));
    case "volume_asc":
      return copy.sort((a, b) => (a.cbQuote?.volume ?? Infinity) - (b.cbQuote?.volume ?? Infinity));
    case "stock_change_desc":
      return copy.sort((a, b) => (changePct(b.stockQuote) ?? -Infinity) - (changePct(a.stockQuote) ?? -Infinity));
    case "stock_change_asc":
      return copy.sort((a, b) => (changePct(a.stockQuote) ?? Infinity) - (changePct(b.stockQuote) ?? Infinity));
    case "cb_change_desc":
      return copy.sort((a, b) => (changePct(b.cbQuote) ?? -Infinity) - (changePct(a.cbQuote) ?? -Infinity));
    case "cb_change_asc":
      return copy.sort((a, b) => (changePct(a.cbQuote) ?? Infinity) - (changePct(b.cbQuote) ?? Infinity));
  }
}

type ViewMode = "card" | "list";
type GroupMode = "none" | "industry";

interface Group {
  industry: string;
  rows: CBRow[];
}

const NO_INDUSTRY = "其他／未分類";

export function CBListPage({ rows, loading, error, search, filters, watchSet, onToggleWatch, onSelect, sort }: Props) {
  const [view, changeView] = usePersistedState<ViewMode>("cb-radar:list-view", "card", ["card", "list"]);
  const [group, changeGroup] = usePersistedState<GroupMode>("cb-radar:list-group", "none", ["none", "industry"]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggleCollapsed(code: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }
  const filtered = useMemo(() => {
    let r = applyFilters(rows, filters);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(
        (x) => x.cb_name.toLowerCase().includes(q) || x.cb_code.includes(q) || (x.stock_code ?? "").includes(q),
      );
    }
    return sortRows(r, sort);
  }, [rows, filters, search, sort]);

  // 同產業分組：產業的順序依目前排序下最前面那檔 CB；沒有產業別的放最後
  const grouped = useMemo(() => {
    if (group !== "industry") return null;
    const map = new Map<string, Group>();
    for (const r of filtered) {
      const ind = r.stock?.industry || NO_INDUSTRY;
      const g = map.get(ind) ?? { industry: ind, rows: [] };
      g.rows.push(r);
      map.set(ind, g);
    }
    const all = [...map.values()];
    return [...all.filter((g) => g.industry !== NO_INDUSTRY), ...all.filter((g) => g.industry === NO_INDUSTRY)];
  }, [filtered, group]);

  function renderRow(row: CBRow) {
    return view === "list" ? (
      <CBRowCompact key={row.cb_code} row={row} watched={watchSet.has(row.cb_code)} onToggleWatch={onToggleWatch} onClick={() => onSelect(row)} />
    ) : (
      <CBCard key={row.cb_code} row={row} watched={watchSet.has(row.cb_code)} onToggleWatch={onToggleWatch} onClick={() => onSelect(row)} />
    );
  }

  return (
    <div className="list">
      <div className="panel-head">
        <div className="panel-title">CB 總表</div>
        <div className="view-toggle" role="tablist" aria-label="檢視模式">
          <button className={view === "card" ? "on" : ""} onClick={() => changeView("card")} role="tab" aria-selected={view === "card"}>
            卡片
          </button>
          <button className={view === "list" ? "on" : ""} onClick={() => changeView("list")} role="tab" aria-selected={view === "list"}>
            列表
          </button>
        </div>
      </div>
      <div className="group-row">
        <span className="group-label">分組</span>
        <div className="view-toggle" role="tablist" aria-label="分組方式">
          <button className={group === "none" ? "on" : ""} onClick={() => changeGroup("none")} role="tab" aria-selected={group === "none"}>
            不分組
          </button>
          <button className={group === "industry" ? "on" : ""} onClick={() => changeGroup("industry")} role="tab" aria-selected={group === "industry"}>
            同產業
          </button>
        </div>
      </div>
      <div className="panel-sub">資料來源：統一證券 CBAS + TWSE MIS · 每幾分鐘更新</div>
      <div className="list-meta">
        <span>
          符合 <b style={{ color: "var(--ink)" }}>{filtered.length}</b> / {rows.length} 檔
        </span>
      </div>

      {loading && <div className="state-msg">載入中…</div>}
      {error && <div className="state-msg error">讀取失敗：{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="state-msg">沒有符合篩選條件的CB</div>}

      {!grouped && filtered.map(renderRow)}

      {grouped &&
        grouped.map((g) => {
          const open = !collapsed.has(g.industry);
          return (
            <div className="cgroup" key={g.industry}>
              <div className="cgroup-head" onClick={() => toggleCollapsed(g.industry)}>
                <div className="cg-name">
                  <b>{g.industry}</b>
                  <span className="cg-count">{g.rows.length} 檔 CB</span>
                </div>
                <span className="cg-caret">{open ? "▴" : "▾"}</span>
              </div>
              {open && <div className="cgroup-body">{g.rows.map(renderRow)}</div>}
            </div>
          );
        })}
    </div>
  );
}
