// 「有擔保／無擔保」文字判斷與 TCRI 數字擷取：全站共用，避免各處各寫一份字串判斷
export function hasGuarantee(text: string | null | undefined): boolean {
  return !!text && !text.includes("無");
}

export function tcriDigit(text: string | null | undefined): string | null {
  return text?.match(/\d/)?.[0] ?? null;
}
