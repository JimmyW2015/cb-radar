# 開發紀錄

給日後開發參考用，記錄架構決策、踩過的坑、已知限制。使用者需求討論過程不重複記錄，只留技術重點。

## 系統全貌

```
統一證券CBAS ──┐
TWSE MIS ──────┼──> Supabase (Postgres + Edge Functions + pg_cron) ──> 前端 PWA (React+Vite)
TWSA edoc2 ────┘         ↑                                              │
(本機 sync_auctions.py 寫入)                                    GitHub Pages 部署
```

- Supabase 專案：`cb-radar`（project_id: `euhreglmhsodxntmvkkr`），區域 ap-southeast-1
- GitHub repo：https://github.com/JimmyW2015/cb-radar （public，之後若升級GitHub付費方案可考慮轉private，見下方「存取控制」）
- 線上網址：https://jimmyw2015.github.io/cb-radar/（**需要登入**，見下方「存取控制」）

## 資料來源

| 來源 | 用途 | 存取方式 |
|---|---|---|
| 統一證券 CBAS (`cbas16889.pscnet.com.tw/api/CbasQuote/*`) | 已發行CB資料、預計發行漏斗（董事會公告/已申報生效/即將上市） | 公開 JSON API，免登入 |
| TWSE MIS (`mis.twse.com.tw/stock/api/getStockInfo.jsp`) | 盤中即時報價（股票+CB） | 非正式公開端點，需先 GET `index.jsp` 拿 JSESSIONID |
| TWSA edoc2 (`web.twsa.org.tw/edoc2/`) | 承銷公告(CB競拍/詢圈公告) + 開標統計表(得標明細) | ASP.NET WebForms，需模擬 postback |
| TWSE ISIN (`isin.twse.com.tw/isin/C_public.jsp`) | 判斷母股是上市(TSE)還是上櫃(TPEx)，決定MIS查詢用 `tse_`/`otc_` 前綴 | 公開，MS950(Big5)編碼 |

## 存取控制（2026-09-03新增）

GitHub Pages不支援「repo私有但發布網站也私有」（除非Enterprise Cloud，個人專案不划算），
所以改成在應用層加驗證，而不是靠平台層：

- 用 Supabase Auth 建了一個帳號（email+密碼登入），前端加了`src/components/Login.tsx` +
  `src/lib/useAuth.ts`，沒登入只會看到登入畫面
- **關鍵**：光有登入畫面不夠，因為`anon` public key本來就會被打包進前端JS、任何人都能從
  瀏覽器devtools挖出來直接打Supabase REST API繞過登入畫面。所以同時把所有資料表的RLS
  policy從`using (true)`（公開可讀）改成`using (auth.role() = 'authenticated')`（要登入
  才能讀）。這樣就算有人繞過UI直接呼叫API，沒登入一樣拿不到資料（已用curl驗證：帶anon
  key但沒登入session，回傳空陣列）
- 後端排程（`sync-cbas`/`poll-quotes`/本機`sync_auctions.py`）都是用`service_role`
  key寫入，`service_role`本來就無視RLS，不受影響
- **登入密碼不存在repo/DEVLOG裡**，只有使用者知道，忘記密碼要去Supabase Dashboard →
  Authentication → Users 重設

## 資料庫 Schema（Supabase Postgres，RLS 要求登入才能讀）

- `stocks` — 母股主檔，`market` 欄位存 `TSE`/`TPEx`
- `bonds` — 已發行CB主檔（CBAS `GetIssuedCBSchedule`）
- `quotes` — 盤中報價快照，PK 是 `symbol`（如 `tse_1101.tw`），`ref_code` 存不帶前綴的代碼方便查詢
- `pipeline` — 預計發行漏斗，`stage` 欄位分 `board_announcement`/`effective`/`recently_listed`
- `auctions` — TWSA「承銷公告」清單 + 從公告PDF解析出的欄位（`issue_price_pct`、`conversion_premium_pct`、`bid_opening_date`等）
- `bid_stats` — TWSA「開標統計表」PDF解析結果，**PK是`cb_code`**，直接從PDF標題（如「志聖三 (24673)」）解析取得，這是可靠的CB對應關係

## Edge Functions（Supabase）

- `sync-cbas`：抓CBAS四支API，寫入`bonds`/`stocks`/`pipeline`。pg_cron排程：平日08:30 UTC+8
- `poll-quotes`：抓TWSE MIS報價，寫入`quotes`。內建時段自我檢查（09:00–13:40 Taipei平日才真的執行，否則直接回傳`skipped`），還會自動幫`stocks.market`為null的新股票分類（呼叫TWSE ISIN）。pg_cron排程：平日每3分鐘
- `sync-auctions`：**已棄用**，因為TWSA會拒絕Supabase Edge Function的連線（cloud IP被擋），改用本機腳本

## 本機排程：`sync_auctions.py`

因為TWSA擋雲端IP，這支要在使用者自己電腦跑（Windows工作排程器，每天16:30）。做兩件事：
1. 抓「承銷公告」(`rblReportType=UnderwritingNotice`)清單，篩CB相關案件，下載公告PDF解析欄位 → 寫入`auctions`
2. 抓「競拍公告/開標統計表」(`rblReportType=Auction`)清單，下載「開標統計表」PDF（`imgbtnReportFileName`按鈕，不是`imgbtnAuctionFileName`），解析出精確的`cb_code` → 寫入`bid_stats`

用 `.bid_stats_seen.json` 本機檔案追蹤已處理過的案件，避免重複下載PDF。

## 前端

React 19 + Vite + TypeScript，`vite-plugin-pwa`（manifest+service worker）。單頁應用，底部導覽4分頁（總表/預計發行/競拍詢圈/自選）。自選清單存在瀏覽器localStorage，沒有後端使用者系統。

關鍵檔案：
- `src/lib/filters.ts` — CB總表篩選邏輯與預設值
- `src/lib/quote.ts` — 從quotes計算漲跌%（`changePct`）
- `src/lib/marketStatus.ts` — 開盤時段判斷，`isQuoteRefreshWindow`跟後端`poll-quotes`的時段邏輯要保持一致
- `src/lib/format.ts` — 只留`fmtDateROC`（全站日期都用民國年）
- `src/App.css` — 所有樣式集中在這，`.card-bottom`的`grid-template-columns`是刻意不等寬（見下方踩坑記錄）

## 部署：GitHub Pages

`gh` CLI的OAuth token沒有`workflow` scope，推不上`.github/workflows/`，所以沒用GitHub Actions自動部署。改用：
```bash
cd app && npm run build && npx gh-pages -d dist -m "訊息"
```
直接把`dist/`推到`gh-pages`分支，GitHub Pages從該分支發布。`.github/workflows/deploy.yml`寫好放著但沒追蹤進git（在`.gitignore`），等之後跑`gh auth refresh -s workflow`授權後可以改回Actions自動部署。

`vite.config.ts`裡`base: "/cb-radar/"`要跟repo名稱一致，manifest的`start_url`/`scope`也要同步改。

## 踩過的坑（重要，之後容易再犯）

1. **TWSA表單`ddlYear`要送西元年不是民國年**：下拉選單顯示「115」但`<option value>`實際是「2026」。送錯值會讓ASP.NET的`__EVENTVALIDATION`驗證失敗，回傳500錯誤（"Invalid postback"類型），而且**不會報明顯的錯誤訊息**，容易誤以為是別的問題。

2. **TWSA「開標統計表」欄位index抓錯**：`公告檔`(`imgbtnAuctionFileName`)跟`開標統計表`(`imgbtnReportFileName`)是兩個不同按鈕，一開始抓錯index導致下載到錯的PDF，解析全部失敗但沒有明顯報錯（只是解析不出預期欄位）。

3. **TWSA PDF文字用了CJK Radical Supplement變體字元**：像「日」被編碼成U+2F42而非標準的U+65E5，導致含「開標日期」等字的正則表達式悄悄比對失敗。解法：PDF文字擷取後一律先跑`unicodedata.normalize('NFKC', text)`（Python）或`text.normalize('NFKC')`（JS）。

4. **TWSA會擋雲端資料中心IP**：Supabase Edge Function連線TWSA得到"Connection reset by peer"，但本機/瀏覽器連線完全正常。TWSE官方網域（`mis.twse.com.tw`、`isin.twse.com.tw`）則不會擋。判斷依據不是「.gov.tw同源」而是實際測試。

5. **TWSE MIS回應裡沒有`tse_`/`otc_`前綴**：`msgArray[].{@,c,ch}`欄位都是純代碼(`1101.tw`)，只有`key`欄位帶前綴+日期(`tse_1101.tw_20260903`)，要用`key`來對應回原本查詢用的symbol，不能直接假設回應順序跟請求順序一致。

6. **CB的母股不能都當作上市股票查**：一開始全部用`tse_`前綴查MIS，導致約一半上櫃母股查不到資料（回傳空的`{"tv":"-","z":"-"}`但不報錯）。要先用TWSE ISIN清單（`strMode=2`上市/`strMode=4`上櫃）分類每檔母股，注意「創新板」是`strMode=2`裡的獨立區塊但仍用`tse_`前綴查MIS。

7. **CB與承銷公告的可靠對應關係，不能靠公司名稱模糊比對**：一家公司常常發過好幾檔CB，用「公司名稱+日期最接近」配對曾經配錯（志聖工業兩個不同案件配到同一檔CB）。後來發現「開標統計表」PDF標題本身就寫著「CB名稱 (CB代碼)」，改用這個當可靠外鍵，`bid_stats.cb_code`才是精確配對。

8. **`bid_stats.cb_code`不能設外鍵強制約束**：開標完成的時間點可能早於CBAS把該檔CB納入`bonds`表（開標→正式發行掛牌中間有時間差），設FK會導致部分插入失敗。改成純文字欄位，不強制參照完整性，靠應用層JOIN。

9. **PWA service worker快取**：前端改版部署後，已安裝的PWA/瀏覽器分頁不會馬上看到新版，要重新整理一兩次或清除快取。開發時用瀏覽器工具`navigator.serviceWorker.getRegistrations()`+`caches.keys()`手動清除比較快。

10. **CSS Grid等寬欄位在內容長度差異大時會裁切或跑版**：CB卡片下方指標從4欄改3欄、又改回4欄但用**不等寬**`grid-template-columns`（依每欄兩列中最長字串比例分配，例如`8fr 9fr 6fr 5fr`），才同時滿足「固定兩行」跟「文字不被裁切」。純粹加大字體或減少欄數各自都會顧此失彼。

## 已知限制（不是bug，是誠實的資料涵蓋率）

- `auctions`表的PDF欄位解析（發行價格/轉換溢價率/開標日期等）約六七成成功率，取決於各承銷商公告書措辭不同，未涵蓋的欄位`raw_parsed.full_text`裡還留著原文可以之後再補規則
- `quotes`表CB報價約381/387（少數幾檔MIS查不到，可能是流動性極低或代碼變動的邊緣案例）
- `auctions`表本身（承銷公告清單）沒有`cb_code`外鍵；只有`bid_stats`表有可靠的`cb_code`（來源不同，見上方踩坑#7）
- Supabase免費方案閒置一段時間可能自動暫停，目前不確定內部pg_cron呼叫算不算「活動」而豁免

## 下次如果要繼續做

- 如果使用者授權`gh auth refresh -s workflow`，可以把`.github/workflows/deploy.yml`加回git追蹤，改成push自動部署
- `auctions`表的PDF正則解析規則可以持續針對解析失敗的案例補充
- 母股報價目前只在09:00-13:40輪詢，若要看盤前/盤後零股等資料需另外處理
