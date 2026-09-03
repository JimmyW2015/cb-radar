# CB Radar

台灣可轉換公司債即時報價、預計發行與競拍/詢圈公告追蹤 PWA。

**線上網址**：https://jimmyw2015.github.io/cb-radar/（手機瀏覽器開啟後可「加到主畫面」）

**需要登入**：網站本身跟資料庫都設了帳密驗證（Supabase Auth），沒登入看不到任何資料。
帳號密碼**不存在repo裡**（避免公開repo外流），忘記密碼可以在 Supabase Dashboard →
Authentication → Users 找到帳號重設。

**開發紀錄**：[DEVLOG.md](DEVLOG.md) — 架構決策、踩過的坑、已知限制，日後開發前建議先看

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

`sync-cbas`、`poll-quotes` 已經用 Supabase 內建的 `pg_cron` + `pg_net` 排程呼叫，
不需要額外主機。`poll-quotes` 內建時段檢查，只有平日 09:00–13:40（台北時間）才會真的
去抓報價，其餘時間呼叫會直接跳過。

## 前端部署（GitHub Pages）

網頁版本放在 `gh-pages` 分支，由 `app/dist` 的 build 產物直接發布，不經過 GitHub Actions
（目前 `gh` CLI 的 OAuth token 沒有 `workflow` 權限，沒辦法推 `.github/workflows/`；
`.github/workflows/deploy.yml` 這支寫好但目前沒啟用，之後跑 `gh auth refresh -s workflow`
拿到權限後把它加回 git 追蹤、推上去，就能改成每次 push 自動部署）。

**手動重新部署**（改完前端程式碼後）：
```bash
cd app
npm run build
npx gh-pages -d dist -m "Deploy CB Radar"
```
幾分鐘內 https://jimmyw2015.github.io/cb-radar/ 就會更新成最新版本。
