# MarketPilot 公開市場儀表板

這是 MarketPilot 的獨立公開網站。前端由 `site/` 中四個公開檔案組成，透過 GitHub Pages 提供 HTTPS 存取；`api/` 是 Deno Deploy 的受限研究服務原始碼，不含任何 Secret。

本站程式碼以 [MIT License](LICENSE) 開放。價格行為研究流程參考 [PA_Agent](https://github.com/rosemarycox5334-debug/PA_Agent/tree/cd0aca2da684fb342bc25f6e14bc980dc8480dab) 的公開架構說明；PA_Agent 原專案採 AGPL-3.0-or-later。本站的區間、重疊、突破與觀望閘門由 MarketPilot 獨立實作，沒有複製其程式碼、提示詞、策略文件或桌面 UI。兩者的研究結果不等同。

行情功能受公開資料來源的可用性、更新延遲與瀏覽器連線限制影響。顯示內容用於市場研究，不保證預測或投資成果。這個版本不提供帳戶存取或交易下單功能。站方 Gemini API key 與金十 Token 只保存在 Deno Deploy Secrets；訪客也可自備 Gemini key 供單次研究使用，金鑰不寫入前端儲存空間或 Deno KV。Deno KV 執行快取與用量限制。

每次 main 分支更新，GitHub Actions 會先執行公開內容驗證，再發布網站；Deno 的 GitHub 整合依 `api/` 變更更新研究服務。Actions 使用固定版本的官方動作；只有部署工作具備 Pages 與身分權杖權限。此儲存庫僅接受固定清單中的前端、Deno 原始碼與部署設定。

本機公開來源檔案更新後，可由發布工具同步至這個專用儲存庫。同步不會合併或強制覆寫遠端分歧；遇到驗證、授權或版本衝突會停止。
