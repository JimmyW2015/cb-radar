import { useState } from "react";
import { exportCsv, type ExportSpec } from "../lib/exportCsv";

export function ExportButton({ spec, label }: { spec: ExportSpec; label: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true);
    setMsg("");
    try {
      const n = await exportCsv(spec, (rows) => setMsg(`已讀取 ${rows.toLocaleString()} 筆…`));
      setMsg(n === 0 ? "沒有資料" : `已匯出 ${n.toLocaleString()} 筆`);
    } catch (e) {
      setMsg(`匯出失敗：${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div className="export-item">
      <button className="export-btn" onClick={run} disabled={busy}>
        {busy ? "匯出中…" : label}
      </button>
      {msg && <span className="export-msg">{msg}</span>}
    </div>
  );
}
