import { CBCard } from "../components/CBCard";
import type { CBRow } from "../lib/types";

interface Props {
  rows: CBRow[];
  watchSet: Set<string>;
  onToggleWatch: (code: string) => void;
  onSelect: (row: CBRow) => void;
}

export function WatchlistPage({ rows, watchSet, onToggleWatch, onSelect }: Props) {
  const watched = rows.filter((r) => watchSet.has(r.cb_code));

  if (watched.length === 0) {
    return (
      <div className="list watch-empty">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--ink-faint)" strokeWidth="1.6">
          <path d="M12 17.3l-6.2 3.3 1.2-6.9L2 8.9l7-1L12 1.5l3 6.4 7 1-5 4.8 1.2 6.9z" />
        </svg>
        <div className="watch-empty-text">
          尚未加入自選 CB
          <br />
          在總表卡片點擊 ☆ 即可加入
        </div>
      </div>
    );
  }

  return (
    <div className="list">
      <div className="panel-title">自選</div>
      <div className="list-meta">
        <span>{watched.length} 檔自選</span>
      </div>
      {watched.map((row) => (
        <CBCard key={row.cb_code} row={row} watched onToggleWatch={onToggleWatch} onClick={() => onSelect(row)} />
      ))}
    </div>
  );
}
