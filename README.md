# CB Radar — 排程腳本

## 目前架構

| 資料源 | 執行方式 | 狀態 |
|---|---|---|
| 統一證券 CBAS（已發行CB + 預計發行漏斗） | Supabase Edge Function `sync-cbas` | 已上線，可排程 |
| TWSE MIS（盤中報價） | Supabase Edge Function `poll-quotes` | 已上線，可排程 |
| TWSA 承銷公告 + 開標結果PDF解析 | 本機腳本 `sync_auctions.py` | 需在本機排程執行 |
| TWSA 競拍公告/開標統計表（`bid_stats`） | 同一支 `sync_auctions.py`（跑完後接著跑） | 已補完本年度64筆，含逐筆得標價位分布 |

TWSA 網站會拒絕雲端資料中心的連線（Supabase Edge Function 測試被連線拒絕），所以這支
只能放在一般網路環境（你的電腦、或家裡/公司的固定IP主機）執行。

## 一次性設定

1. 安裝套件：
   ```bash
   pip install requests beautifulsoup4 pypdf
   ```
2. 複製 `.env.example` 為 `.env`，填入 `SUPABASE_SERVICE_ROLE_KEY`
   （Supabase Dashboard → cb-radar 專案 → Settings → API → service_role secret）
3. 手動跑一次確認：
   ```bash
   python sync_auctions.py
   ```
   第一次執行會有比較多歷史案件要補（今年度所有CB競拍/詢圈案件，一次最多處理40筆，
   跑幾次就會補完，之後每天只會有新增的一兩筆）。

## 排程設定（Windows工作排程器）

1. 開始 → 搜尋「工作排程器」（Task Scheduler）
2. 建立工作 → 觸發程序：每天，時間建議排在下午4點後（台股收盤+公告更新後）
3. 動作 → 啟動程式：
   - 程式/指令碼：`python`（或 python.exe 完整路徑）
   - 加入引數：`sync_auctions.py`
   - 開始位置：`D:\Claude Test\CB-Radar`
4. 存檔即可，之後每天會自動執行

## 待補：CBAS / TWSE 排程上雲端 cron

`sync-cbas`（建議每日一次，例如開盤前）與 `poll-quotes`（建議開盤時段每3-5分鐘一次）
兩支已經是 Supabase Edge Function，還沒接上自動排程，下一步要用 `pg_cron` + `pg_net`
在 Supabase 內部排程呼叫，不需要額外主機。
