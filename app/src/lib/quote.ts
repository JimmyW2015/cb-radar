import type { Quote } from "./types";

export function changePct(q: Quote | null | undefined): number | null {
  if (!q || q.price === null || q.prev_close === null || q.prev_close === 0) return null;
  return ((q.price - q.prev_close) / q.prev_close) * 100;
}

export function changeAmt(q: Quote | null | undefined): number | null {
  if (!q || q.price === null || q.prev_close === null) return null;
  return q.price - q.prev_close;
}
