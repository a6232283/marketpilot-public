# MarketPilot 公開市場儀表板

這是 MarketPilot 的獨立公開網站。前端由 `site/` 中五個公開檔案組成，透過 GitHub Pages 提供 HTTPS 存取；`api/` 是在站方電腦以 Deno 執行的受限研究服務原始碼，不含任何 Secret。

本站程式碼以 [MIT License](LICENSE) 開放。價格行為研究流程參考 [PA_Agent](https://github.com/rosemarycox5334-debug/PA_Agent/tree/cd0aca2da684fb342bc25f6e14bc980dc8480dab) 的公開架構說明；PA_Agent 原專案採 AGPL-3.0-or-later。本站的區間、重疊、突破與觀望閘門由 MarketPilot 獨立實作，沒有複製其程式碼、提示詞、策略文件或桌面 UI。兩者的研究結果不等同。

第二個 AI 分析選單「TradingAgents 多角色研究」參考 [TradingAgents](https://github.com/tauricresearch/tradingagents/tree/35543d0248bf89fcb92b17a15858ad0c0e940687) 的角色分工。原專案為 Apache-2.0 授權；本站沒有複製其程式碼或提示詞，是使用現有行情與事件資料的獨立流程精簡版。一次執行五個實際模型回合（技術、事件、多方、空方、風控；上游暫時錯誤最多重試一次並額外計入額度），不包含上游基本面、社群、完整 LangGraph、投資組合、回測或模擬交易。公開策略圖的 20 日支撐／壓力在市場資料同意後，經受限唯讀端點另取最近 20 根已完成日 K 的低／高價，不消耗 AI 額度；日線不足時顯示無資料。

行情功能受公開資料來源的可用性、更新延遲與瀏覽器連線限制影響。顯示內容用於市場研究，不保證預測或投資成果。這個版本不提供帳戶存取或交易下單功能。站方 Gemini API key 與金十 Token 只保存在站方電腦並由後端程序讀取；訪客也可自備 Gemini key 供單次研究使用，金鑰不寫入前端儲存空間或 Deno KV。本機持久化 Deno KV 執行快取與用量限制。

每次 main 分支更新，GitHub Actions 會先執行公開內容驗證，再發布網站；站方電腦監看已通過語法檢查的 API 原始碼與憑證設定，更新後自動重載研究服務。Actions 使用固定版本的官方動作；只有部署工作具備 Pages 與身分權杖權限。此儲存庫僅接受固定清單中的前端、Deno 原始碼與部署設定。

本機公開來源檔案更新後，可由發布工具同步至這個專用儲存庫。同步不會合併或強制覆寫遠端分歧；遇到驗證、授權或版本衝突會停止。

## 日線規則與歷史回測

公開版預設開啟行情規則引擎，與本機同樣使用最近 260 根已收盤日 K 的 EMA20/50、RSI14、ATR14、20 日動能與價格結構閘門。圖表分鐘週期不會改變日線策略基礎。每 15 分鐘檢查；不消耗 AI 額度。

自訂日期（日線、最長五年）可選九種策略：買進持有、綜合規則、EMA／SMA 雙均線、MACD、時間序列動能、Donchian 通道突破、RSI 與布林通道。可調各策略的週期／門檻、本金、手續費、滑價、做空借貸成本與 ATR 停損／目標倍數；買進持有固定只做多且不用 ATR。結果顯示淨報酬、年化報酬、買進持有基準、回撤、勝率、交易筆數、逐筆交易及 JSON 下載。訊號用前日收盤、次日開盤成交；同日停損／目標雙觸及採保守停損優先。股票使用還原權息價格；回測未重播歷史 AI／新聞、不含真實撮合和融券限制。沒有可保證高報酬或高勝率的參數，選擇策略後應換期間驗證。

回測端點每位訪客每 10 分鐘最多 4 次，全站每小時 60 次；無需 API key。獨立回測引擎為 `api/backtest.ts`，兩版共用前端 `site/backtest-ui.js`。

## 自架公開研究後端

公開前端仍使用 GitHub Pages；API 已遷移至站方電腦 + Tailscale Funnel。Deno 僅作本機執行環境，不使用 Deno Deploy 託管額度。Funnel 只轉送獨立的公開 API，不轉送私人網站。電腦必須保持登入、開機、連網且未休眠；API 離線時前端每分鐘檢查恢復，TradingView 元件仍可獨立使用。

API 可用環境變數設定：`MARKETPILOT_BIND_HOST` 指定迴環介面、`PORT` 指定獨立連接埠、`MARKETPILOT_KV_PATH` 指定私有持久化資料庫、`FUNNEL_HOST` 指定核准的 Tailscale 網域、`PUBLIC_ORIGIN` 指定 Pages 來源。`GEMINI_API_KEY`、`JIN10_MCP_TOKEN`、`RATE_LIMIT_SALT` 僅透過受保護的後端環境傳入。設定 `FUNNEL_HOST` 後，API 要求 Tailscale 重寫的 HTTPS、來源位址及 Funnel 標頭；應配合只監聽迴環介面使用，不可直接暴露此連接埠。

全站每分鐘 120 次請求、最多 8 個同時請求／2 個 AI 研究；每日站方模型呼叫預設 48 次，自備 key 預設 96 次，重試與多角色計入模型次數。每日上限是站方保護設定，不是雲端主機額度。用量保存於本機 KV，重啟不會清零。Tailscale Funnel 有官方固定頻寬限制；資料與 AI 來源仍受各自免費額度限制。
