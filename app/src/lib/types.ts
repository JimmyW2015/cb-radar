export interface Bond {
  cb_code: string;
  cb_name: string;
  stock_code: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  circulation: number | null;
  circulating_balance: number | null;
  balance_ratio: number | null;
  tcri: string | null;
  guarantee_situation: string | null;
  conversion_price: number | null;
  conversion_ratio: number | null;
  underlying_stock_historical_volatility: number | null;
  convertible_bond_market_price: number | null;
  avg_volume_5d: number | null;
  avg_volume_20d: number | null;
  conversion_value: number | null;
  premium_rate: number | null;
  latest_sale_date: string | null;
  latest_sale_price: number | null;
  period: number | null;
  sell_back_yield: number | null;
  stop_conversion_date: string | null;
  stop_converting_until_date: string | null;
  mandatory_redemption_date: string | null;
  reset_conversion_price: string | null;
  reset_conversion_day: string | null;
  reset_price: number | null;
  market_value: number | null;
  remaining_days: number | null;
  updated_at: string;
}

export interface Stock {
  stock_code: string;
  name: string | null;
  industry: string | null;
  updated_at: string;
}

export interface Quote {
  symbol: string;
  ref_code: string;
  type: "stock" | "cb";
  price: number | null;
  bid: number | null;
  ask: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  prev_close: number | null;
  volume: number | null;
  quote_time: string | null;
  updated_at: string;
}

export interface Auction {
  case_no: string;
  report_date: string | null;
  underwriter: string;
  company: string;
  cb_code: string | null;
  bond_type: string | null;
  method: string | null;
  status: string | null;
  pdf_url: string | null;
  issue_price_pct: number | null;
  conversion_price: number | null;
  conversion_premium_pct: number | null;
  auction_lots: number | null;
  self_retained_lots: number | null;
  total_lots: number | null;
  bid_opening_date: string | null;
  payment_deadline: string | null;
  raw_parsed: { full_text?: string } | null;
  updated_at: string;
}

export interface PipelineRow {
  id: number;
  cb_code: string | null;
  code: string | null;
  cb_name: string;
  stage: "board_announcement" | "effective" | "recently_listed";
  tcri: string | null;
  circulation: number | null;
  host_broker: string | null;
  sell_back_conditions: string | null;
  annual: string | null;
  premium_rate: string | null;
  conversion_price: number | null;
  conversion_value: number | null;
  inquiry_auction: string | null;
  announcement_day: string | null;
  delivery_date: string | null;
  expected_effective_date: string | null;
  listing_day: string | null;
  dismantling_day: string | null;
  remark: string | null;
  updated_at: string;
}

export interface PriceLadderEntry {
  seq: number;
  price: number;
  qty: number;
  amount: number;
}

export interface BidStats {
  cb_code: string;
  cb_name: string | null;
  underwriter: string | null;
  auction_method: string | null;
  floor_price: number | null;
  min_winning_price: number | null;
  max_winning_price: number | null;
  issue_price: number | null;
  weighted_avg_price: number | null;
  bid_opening_date: string | null;
  qualified_bid_count: number | null;
  qualified_bid_qty: number | null;
  won_count: number | null;
  won_qty: number | null;
  won_amount: number | null;
  report_pdf_url: string | null;
  price_ladder: PriceLadderEntry[] | null;
  updated_at: string;
}

// Merged view used by the CB list screen
export interface CBRow extends Bond {
  stockQuote: Quote | null;
  cbQuote: Quote | null;
  stock: Stock | null;
}
