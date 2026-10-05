import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { AuctionTimelineRow } from "./timeline";

export function useAuctionTimelines() {
  const [rows, setRows] = useState<AuctionTimelineRow[]>([]);
  useEffect(() => {
    supabase
      .from("auctions")
      .select("case_no,cb_code,report_date,bid_opening_date,payment_deadline,conversion_price,auction_lots,timeline:raw_parsed->timeline")
      .not("cb_code", "is", null)
      .then(({ data }) => setRows((data ?? []) as unknown as AuctionTimelineRow[]));
  }, []);
  return rows;
}
