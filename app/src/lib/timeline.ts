import type { Bond, PipelineRow } from "./types";

export interface AuctionTimelineRow {
  case_no: string;
  cb_code: string | null;
  report_date: string | null;
  bid_opening_date: string | null;
  payment_deadline: string | null;
  conversion_price: number | null;
  auction_lots: number | null;
  timeline: {
    pricing_base_date?: string;
    inquiry_date?: string;
    inquiry_payment_date?: string;
    deduction_date?: string;
    refund_date?: string;
    listing_date_planned?: string;
  } | null;
}

export interface TimelineEvent {
  date: string;
  label: string;
  note?: string;
}

export function buildTimeline(
  bond: Bond,
  auction: AuctionTimelineRow | null,
  pipeline: PipelineRow | null,
): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const add = (date: string | null | undefined, label: string, note?: string) => {
    if (!date || ev.some((e) => e.date === date && e.label === label)) return;
    ev.push({ date, label, note });
  };
  const t = auction?.timeline ?? {};

  add(pipeline?.announcement_day, "董事會決議公告");
  add(pipeline?.expected_effective_date, "預計申報生效");
  add(auction?.report_date, "承銷公告");
  const price = auction?.conversion_price ?? null;
  add(t.pricing_base_date, "訂定轉換價格基準日", price !== null ? `轉換價 ${price} 元` : undefined);
  if (t.inquiry_date) add(t.inquiry_date, "詢價圈購完成");
  else add(auction?.bid_opening_date, "競價拍賣開標");
  add(t.refund_date, "未得標保證金退款");
  add(auction?.payment_deadline ?? t.deduction_date ?? t.inquiry_payment_date, "繳款截止（扣款）");
  add(pipeline?.delivery_date, "交割");
  add(pipeline?.listing_day ?? t.listing_date_planned, "掛牌上櫃／上市", pipeline?.listing_day ? undefined : "預定日");
  add(bond.issue_date, "發行日");
  add(bond.expiry_date, "到期日");

  return ev.sort((a, b) => a.date.localeCompare(b.date));
}
