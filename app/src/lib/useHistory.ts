import { useEffect, useState } from "react";
import { fetchAllPages } from "./fetchAllPages";
import { supabase } from "./supabase";

export interface HistoryRow {
  case_no: string;
  report_date: string | null;
  underwriter: string;
  company: string;
  stock_code: string | null;
  cb_code: string | null;
  bond_type: string | null;
  method: string | null;
  status: string | null;
  pdf_url: string | null;
  issue_price_pct: number | null;
  conversion_price: number | null;
  conversion_premium_pct: number | null;
  auction_lots: number | null;
  bid_opening_date: string | null;
  payment_deadline: string | null;
  timeline: {
    ordinal?: number;
    pricing_base_date?: string;
    inquiry_date?: string;
    inquiry_payment_date?: string;
    deduction_date?: string;
    refund_date?: string;
    listing_date_planned?: string;
  } | null;
}

const COLUMNS =
  "case_no,report_date,underwriter,company,stock_code,cb_code,bond_type,method,status,pdf_url,issue_price_pct,conversion_price,conversion_premium_pct,auction_lots,bid_opening_date,payment_deadline,timeline:raw_parsed->timeline";
export function useHistory() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAllPages<HistoryRow>((from, to) =>
      supabase
        .from("auctions")
        .select(COLUMNS)
        .order("report_date", { ascending: false })
        .order("case_no", { ascending: false })
        .range(from, to),
    )
      .then((all) => !cancelled && setRows(all))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  return { rows, loading, error };
}
