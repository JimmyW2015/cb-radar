export interface DigestCb {
  code: string;
  name: string;
  close: number | null;
  volume: number;
  neg_volume?: number;
  premium: number | null;
}
export interface DigestStock {
  code: string;
  name: string;
  close: number | null;
  volume?: number;
  pct: number | null;
}
export interface DigestReset {
  code: string;
  name: string;
  reset_day: string;
  reset_price: number | null;
  conversion_price: number | null;
  stock_close: number | null;
}
export interface DigestAuction {
  code: string;
  name: string;
  open_date: string;
  min_winning_price: number | null;
  weighted_avg_price: number | null;
  close: number | null;
  volume: number | null;
  note: string;
}

export interface DigestData {
  date: string;
  note?: string;
  source?: string;
  cb_total?: number;
  cb_ok?: number;
  stock_total?: number;
  stock_ok?: number;
  premium_ok?: number;
  top_cb?: DigestCb[];
  top_stock?: DigestStock[];
  movers_up?: DigestStock[];
  movers_down?: DigestStock[];
  near_parity?: DigestCb[];
  small_discount?: DigestCb[];
  resets?: DigestReset[] | null;
  auctions?: DigestAuction[];
  alerts?: string[];
}

export interface DigestRow {
  digest_date: string;
  status: "ok" | "closed" | "pending";
  generated_at: string;
  data: DigestData;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function weekdayOf(date: string): string {
  return WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function p2(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : n.toFixed(2);
}

export function pctText(n: number | null | undefined, signed = true): string {
  if (n === null || n === undefined) return "—";
  return `${signed && n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function md(date: string): string {
  return date.slice(5).replace("-0", "-").replace(/^0/, "").replace("-", "/");
}

export function volText(c: DigestCb): string {
  return c.neg_volume ? `${c.volume}（另議價 ${c.neg_volume}）` : String(c.volume);
}

function cbTable(rows: DigestCb[]): string {
  const lines = ["| 代號 | 名稱 | 現價 | 量(張) | 溢價率 |", "| --- | --- | ---: | ---: | ---: |"];
  for (const c of rows) lines.push(`| ${c.code} | ${c.name} | ${p2(c.close)} | ${volText(c)} | ${pctText(c.premium)} |`);
  return lines.join("\n");
}

function coverage(d: DigestData): string[] {
  const noTrade = (d.cb_total ?? 0) - (d.cb_ok ?? 0);
  return [
    `- **資料日期**：${d.date}（收盤後，台北時間；使用官方盤後資料，未使用盤中報價）`,
    `- **來源**：${d.source ?? "—"}`,
    `- **覆蓋**：CB ${d.cb_ok}/${d.cb_total} 檔有等價成交（${noTrade} 檔當日無等價成交，無法計價）；標的 ${d.stock_ok}/${d.stock_total} 檔；可算溢價 ${d.premium_ok} 檔`,
  ];
}

export function digestToMarkdown(row: DigestRow): string {
  const d = row.data;
  if (row.status === "pending") {
    return `# 台股可轉債盯市摘要｜${row.digest_date}（日報尚未產出）

${d.note ?? "日報尚未產出，預計約 18:30 產出。"}
`;
  }
  if (row.status === "closed") {
    return `# 台股可轉債盯市摘要｜${row.digest_date}（休市）\n\n${d.note ?? "休市。"}\n`;
  }
  const out: string[] = [];
  out.push(`# 台股可轉債盯市摘要｜${row.digest_date}（收盤後）`, "");
  out.push("## 資料時間與覆蓋率", ...coverage(d), "");

  out.push("## 今日 CB 成交量前 15 名", cbTable(d.top_cb ?? []), "");

  out.push("## 標的量能前 10 名", "| 代號 | 名稱 | 現價 | 量(張) | 漲跌幅 |", "| --- | --- | ---: | ---: | ---: |");
  for (const s of d.top_stock ?? []) out.push(`| ${s.code} | ${s.name} | ${p2(s.close)} | ${s.volume} | ${pctText(s.pct)} |`);
  out.push("");

  const mv = (arr: DigestStock[] | undefined) => (arr ?? []).map((s) => `${s.code} ${s.name} ${pctText(s.pct)}`).join("、") || "無";
  out.push("## 相對昨收波動大的標的", `**漲幅**：${mv(d.movers_up)}`, `**跌幅**：${mv(d.movers_down)}`, "");

  out.push("## 接近平價（溢價率 ±0.5% 內）且今日有量", cbTable(d.near_parity ?? []));
  if ((d.small_discount ?? []).length) {
    out.push("", "另有小折價有量：" + (d.small_discount ?? []).map((c) => `${c.code} ${c.name} ${pctText(c.premium)}（${c.volume}張）`).join("、") + "。");
  }
  out.push("");

  if (d.resets) {
    out.push("## 近期重設（CBAS「即將重設」）", "| 重設日 | 券名 | 重設價格 | 現行轉換價 | 標的現價 |", "| --- | --- | ---: | ---: | ---: |");
    for (const r of d.resets) out.push(`| ${md(r.reset_day)} | ${r.code} ${r.name} | ${r.reset_price ?? "—"} | ${r.conversion_price ?? "—"} | ${p2(r.stock_close)} |`);
    if (d.resets.length === 0) out.push("| — | 無 | | | |");
    out.push("");
  }

  out.push("## 競拍券追蹤（近 45 日開標）", "| 券名 | 今日收 | 今日量 | 最低得標價 | 加權平均得標價 | 對照 |", "| --- | ---: | ---: | ---: | ---: | --- |");
  for (const a of d.auctions ?? []) out.push(`| ${a.code} ${a.name} | ${p2(a.close)} | ${a.volume ?? "—"} | ${p2(a.min_winning_price)} | ${p2(a.weighted_avg_price)} | ${a.note} |`);
  out.push("");

  out.push("## 一句過熱／異常提醒", (d.alerts ?? []).join("；") || "今日無特別異常。", "");
  return out.join("\n");
}

// 台北時間今天的日期（YYYY-MM-DD）與星期
export function taipeiToday(): { date: string; dow: number } {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  return { date: t.toISOString().slice(0, 10), dow: t.getUTCDay() };
}

export { downloadText } from "./download";
