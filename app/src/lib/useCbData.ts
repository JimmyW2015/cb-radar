import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { isQuoteRefreshWindow } from "./marketStatus";
import type { Bond, CBRow, Quote, Stock } from "./types";

export function useCbData() {
  const [rows, setRows] = useState<CBRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const [bondsRes, stocksRes, quotesRes] = await Promise.all([
      supabase.from("bonds").select("*"),
      supabase.from("stocks").select("*"),
      supabase.from("quotes").select("*"),
    ]);

    if (bondsRes.error) setError(bondsRes.error.message);
    else if (stocksRes.error) setError(stocksRes.error.message);
    else if (quotesRes.error) setError(quotesRes.error.message);

    const bonds = (bondsRes.data ?? []) as Bond[];
    const stocks = (stocksRes.data ?? []) as Stock[];
    const quotes = (quotesRes.data ?? []) as Quote[];

    const stockByCode = new Map(stocks.map((s) => [s.stock_code, s]));
    const quoteByRef = new Map<string, Quote>();
    for (const q of quotes) quoteByRef.set(`${q.type}:${q.ref_code}`, q);

    const merged: CBRow[] = bonds.map((b) => ({
      ...b,
      stock: b.stock_code ? stockByCode.get(b.stock_code) ?? null : null,
      stockQuote: b.stock_code ? quoteByRef.get(`stock:${b.stock_code}`) ?? null : null,
      cbQuote: quoteByRef.get(`cb:${b.cb_code}`) ?? null,
    }));

    setRows(merged);
    setLastFetched(new Date());
    setLoading(false);
  }

  useEffect(() => {
    load();
    // Quotes only refresh 09:00–13:40 Taipei time on weekdays; outside that
    // window skip the network round-trip entirely (bonds/stocks don't change
    // intraday, so re-fetching them would just be wasted reads).
    const interval = setInterval(() => {
      if (isQuoteRefreshWindow()) load();
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  return { rows, loading, error, lastFetched, reload: load };
}
