import { useEffect, useMemo, useState } from "react";
import { fmtDateROC } from "../lib/format";
import { taipeiToday } from "../lib/digest";
import { CB_EXPORT, CONV_EXPORT, STOCK_EXPORT, exportCsv, type ExportSpec } from "../lib/exportCsv";
import { fetchAllPages } from "../lib/fetchAllPages";
import { supabase } from "../lib/supabase";

interface CbUniverse {
  cb_code: string;
  cb_name: string;
  stock_code: string;
  stock_name: string | null;
  first_date: string;
  last_date: string;
  live: boolean;
  delisted_on: string | null;
}

interface StockGroup {
  code: string;
  name: string;
  cbs: CbUniverse[];
}

type Status = "all" | "live" | "dead";
type Scope = "all" | "stock";

function useCbUniverse() {
  const [rows, setRows] = useState<CbUniverse[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchAllPages<CbUniverse>((from, to) =>
      supabase.from("cb_universe").select("*").order("stock_code").order("cb_code").range(from, to),
    )
      .then((all) => !cancelled && setRows(all))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return rows;
}

const statusLabel = (live: boolean) => (live ? "流通中" : "已下線");

function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ExportPanel() {
  const universe = useCbUniverse();
  const [want, setWant] = useState({ cb: true, stock: false, conv: false });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set()); // 取消勾選的 CB
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<string[]>([]);

  const stocks = useMemo(() => {
    const map = new Map<string, StockGroup>();
    for (const u of universe) {
      const g = map.get(u.stock_code) ?? { code: u.stock_code, name: u.stock_name ?? u.stock_code, cbs: [] };
      g.cbs.push(u);
      map.set(u.stock_code, g);
    }
    return [...map.values()];
  }, [universe]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      q
        ? stocks
            .filter((s) => s.code.includes(q) || s.name.toLowerCase().includes(q) || s.cbs.some((c) => c.cb_name.toLowerCase().includes(q)))
            .slice(0, 8)
        : [],
    [stocks, q],
  );
  const picked = stocks.find((s) => s.code === pickedCode) ?? (matches.length === 1 ? matches[0] : null);

  const statusOk = (live: boolean) => status === "all" || (status === "live") === live;
  const shownCbs = picked ? picked.cbs.filter((c) => statusOk(c.live)) : [];
  const chosen = shownCbs.filter((c) => !off.has(c.cb_code)).map((c) => c.cb_code);

  function preset(kind: "all" | "year" | "3m" | "lastMonth") {
    const today = taipeiToday().date;
    if (kind === "all") {
      setFrom("");
      setTo("");
    } else if (kind === "year") {
      setFrom(`${today.slice(0, 4)}-01-01`);
      setTo(today);
    } else if (kind === "3m") {
      setFrom(shiftDate(today, -92));
      setTo(today);
    } else {
      const first = monthStart(today);
      const lastPrev = shiftDate(first, -1);
      setFrom(monthStart(lastPrev));
      setTo(lastPrev);
    }
  }

  const nothingToExport =
    !(want.cb || want.stock || want.conv) || (scope === "stock" && (!picked || (want.cb || want.conv) && !want.stock && chosen.length === 0));

  async function run() {
    setBusy(true);
    setMsgs([]);
    const period = { from: from || undefined, to: to || undefined };
    const tag = `${scope === "stock" && picked ? picked.code : "全部股票"}_${status === "all" ? "全部狀態" : statusLabel(status === "live")}_${from || "起"}_${to || "今"}`;
    const jobs: [string, ExportSpec][] = [];

    if (scope === "all") {
      const okCb = new Set(universe.filter((u) => statusOk(u.live)).map((u) => u.cb_code));
      const okStock = new Set(universe.filter((u) => statusOk(u.live)).map((u) => u.stock_code));
      const byCb = status === "all" ? undefined : (r: Record<string, unknown>) => okCb.has(String(r.cb_code));
      const byStock = status === "all" ? undefined : (r: Record<string, unknown>) => okStock.has(String(r.stock_code));
      if (want.cb) jobs.push(["CB 日K", { ...CB_EXPORT, ...period, keep: byCb, filename: `CB日K_${tag}.csv` }]);
      if (want.stock) jobs.push(["母股日K", { ...STOCK_EXPORT, ...period, keep: byStock, filename: `母股日K_${tag}.csv` }]);
      if (want.conv)
        jobs.push(["每月轉換", { ...CONV_EXPORT, from: from ? monthStart(from) : undefined, to: to || undefined, keep: byCb, filename: `每月轉換_${tag}.csv` }]);
    } else if (picked) {
      if (want.cb && chosen.length) jobs.push(["CB 日K", { ...CB_EXPORT, ...period, codes: ["cb_code", chosen], filename: `CB日K_${tag}.csv` }]);
      if (want.stock) jobs.push(["母股日K", { ...STOCK_EXPORT, ...period, eq: ["stock_code", picked.code], filename: `母股日K_${tag}.csv` }]);
      if (want.conv && chosen.length)
        jobs.push([
          "每月轉換",
          { ...CONV_EXPORT, from: from ? monthStart(from) : undefined, to: to || undefined, codes: ["cb_code", chosen], filename: `每月轉換_${tag}.csv` },
        ]);
    }

    for (const [label, spec] of jobs) {
      try {
        setMsgs((m) => [...m.filter((x) => !x.startsWith(label)), `${label}：讀取中…`]);
        const n = await exportCsv(spec, (rows) => setMsgs((m) => [...m.filter((x) => !x.startsWith(label)), `${label}：已讀取 ${rows.toLocaleString()} 筆…`]));
        setMsgs((m) => [...m.filter((x) => !x.startsWith(label)), n === 0 ? `${label}：這個條件沒有資料` : `${label}：已匯出 ${n.toLocaleString()} 筆`]);
      } catch (e) {
        setMsgs((m) => [...m.filter((x) => !x.startsWith(label)), `${label}：匯出失敗（${e instanceof Error ? e.message : String(e)}）`]);
      }
    }
    setBusy(false);
  }

  return (
    <div className={`export-panel xp ${open ? "open" : ""}`}>
      <button className="xp-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="xp-toggle-text">
          <b>📥 資料匯出</b>
          <small>行情與轉換資料庫，只增不減 · 點此{open ? "收合" : "展開選項"}</small>
        </span>
        <span className="xp-toggle-act">{open ? "收合 ▴" : "展開 ▾"}</span>
      </button>

      {open && <div className="xp-body">
      <div className="xp-block">
        <div className="xp-label">匯出內容（可複選）</div>
        <div className="xp-checks">
          {(
            [
              ["cb", "CB 日K"],
              ["stock", "母股日K"],
              ["conv", "每月轉換資料"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="xp-check">
              <input type="checkbox" checked={want[k]} onChange={(e) => setWant({ ...want, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="xp-block">
        <div className="xp-label">期間（不選＝全部）</div>
        <div className="xp-dates">
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="起日" />
          <span>～</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="迄日" />
        </div>
        <div className="xp-presets">
          <button onClick={() => preset("all")}>全部期間</button>
          <button onClick={() => preset("year")}>今年</button>
          <button onClick={() => preset("3m")}>近 3 個月</button>
          <button onClick={() => preset("lastMonth")}>上個月</button>
        </div>
      </div>

      <div className="xp-block">
        <div className="xp-label">狀態</div>
        <div className="view-toggle" role="tablist" aria-label="狀態">
          {(
            [
              ["all", "全部"],
              ["live", "流通中"],
              ["dead", "已下線"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={status === k ? "on" : ""} onClick={() => setStatus(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="xp-hint">「已下線」＝不在目前發行清單的 CB。精確下線日從現在起才會記錄；之前下線的只能知道已下線。</div>
      </div>

      <div className="xp-block">
        <div className="xp-label">股票範圍</div>
        <div className="view-toggle" role="tablist" aria-label="股票範圍">
          <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>
            全部股票
          </button>
          <button className={scope === "stock" ? "on" : ""} onClick={() => setScope("stock")}>
            指定股票
          </button>
        </div>

        {scope === "stock" && (
          <>
            <input
              className="xp-input"
              placeholder="輸入母股代號或名稱（例：6187、萬潤）"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPickedCode(null);
                setOff(new Set());
              }}
            />
            {q && matches.length === 0 && <div className="xp-hint">找不到相關的 CB（資料庫只有發行過 CB 的公司）</div>}
            {matches.length > 1 && !picked && (
              <div className="xp-matches">
                {matches.map((s) => (
                  <button key={s.code} onClick={() => setPickedCode(s.code)}>
                    {s.name} <small>{s.code}</small> · {s.cbs.length} 檔 CB
                  </button>
                ))}
              </div>
            )}
            {picked && (
              <div className="xp-cbs">
                <div className="xp-cbhead">
                  <b>
                    {picked.name} {picked.code}
                  </b>
                  <span>
                    <button onClick={() => setOff(new Set())}>全選</button>
                    <button onClick={() => setOff(new Set(shownCbs.map((c) => c.cb_code)))}>全不選</button>
                  </span>
                </div>
                {shownCbs.length === 0 && <div className="xp-hint">這個狀態下沒有 CB</div>}
                {shownCbs.map((c) => (
                  <label key={c.cb_code} className="xp-cb">
                    <input
                      type="checkbox"
                      checked={!off.has(c.cb_code)}
                      onChange={(e) => {
                        const next = new Set(off);
                        if (e.target.checked) next.delete(c.cb_code);
                        else next.add(c.cb_code);
                        setOff(next);
                      }}
                    />
                    <span className="nm">{c.cb_name}</span>
                    <span className="cd">{c.cb_code}</span>
                    <span className={`st ${c.live ? "live" : "dead"}`}>{statusLabel(c.live)}</span>
                    <span className="rg">
                      {fmtDateROC(c.first_date)}–{fmtDateROC(c.last_date)}
                    </span>
                  </label>
                ))}
                <div className="xp-hint">母股日K 是這檔股票本身的行情；勾選的 CB 影響「CB 日K」與「每月轉換資料」。</div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="xp-run">
        <button className="export-btn" onClick={run} disabled={busy || nothingToExport}>
          {busy ? "匯出中…" : `匯出（${Number(want.cb) + Number(want.stock) + Number(want.conv)} 個檔案）`}
        </button>
        {msgs.map((m) => (
          <div key={m} className="export-msg">
            {m}
          </div>
        ))}
      </div>
      </div>}
    </div>
  );
}
