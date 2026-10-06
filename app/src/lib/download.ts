// 把文字存成檔案下載（加 UTF-8 BOM，Excel／記事本都能正確讀中文）
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob(["\uFEFF" + text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
