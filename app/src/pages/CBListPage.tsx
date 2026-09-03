import { useMemo } from "react";
import { CBCard } from "../components/CBCard";
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

export function CBListPage({ rows, loading, error, search, filters, watchSet, onToggleWatch, onSelect, sort }: Props) {
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

  return (
    <div className="list">
      <div className="panel-title">CB 總表</div>
      <div className="panel-sub">資料來源：統一證券 CBAS + TWSE MIS · 每幾分鐘更新</div>
      <div className="list-meta">
        <span>
          符合 <b style={{ color: "var(--ink)" }}>{filtered.length}</b> / {rows.length} 檔
        </span>
      </div>

      {loading && <div className="state-msg">載入中…</div>}
      {error && <div className="state-msg error">讀取失敗：{error}</div>}
      {!loading && !error && filtered.length === 0 && <div className="state-msg">沒有符合篩選條件的CB</div>}

      {filtered.map((row) => (
        <CBCard
          key={row.cb_code}
          row={row}
          watched={watchSet.has(row.cb_code)}
          onToggleWatch={onToggleWatch}
          onClick={() => onSelect(row)}
        />
      ))}
    </div>
  );
}
