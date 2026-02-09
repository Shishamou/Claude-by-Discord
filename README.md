# Discord Claude Bot

從 Discord 遠端操控本機 Claude Code。不需要待在電腦前，用手機打開 Discord 就能下指令、審批工具、追蹤進度。

## 運作原理

透過 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 在本機生成 Claude Code 子程序執行任務，再將過程即時串流到 Discord Thread。

- **使用本機 CLI 登入狀態** — SDK 直接沿用 `claude login` 的認證，不需額外設定 API Key
- **本機必須持續運行** — Bot 停了就無法遠端操控

> **注意**：本專案僅以 Claude Code 訂閱（Max plan）測試。若你使用 API Key 登入 CLI，理論上可運作但**尚未經過測試**，且會消耗 API 額度。

## 功能

- **即時串流** — Claude 的回應以 2 秒節流即時更新，不需等完整回應
- **Thread 隔離** — 每個 `/prompt` 建立獨立 Thread，支援同時執行多個任務
- **續問對話** — 在 Thread 中直接打字即可續問，保留完整對話歷史
- **工具審批** — 未放行的工具操作透過 Discord 按鈕請求核准/拒絕
- **互動式問答** — Claude 的 `AskUserQuestion` 以按鈕顯示，支援單選、多選、自訂回答
- **檔案上傳** — 續問時可附加圖片、PDF、文字檔，Claude 直接讀取
- **對話紀錄** — `/history` 匯出完整 Session 紀錄為 Markdown 檔案
- **重新執行** — `/retry` 用相同 prompt 重跑，全新 Session
- **Token 追蹤** — 累計 Token 消耗與 USD 成本，`/status` 查看統計
- **Rate Limiting** — 防止短時間內大量請求（預設每分鐘 5 次）

## 前置需求

- Node.js 18+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) 已安裝並登入（`claude login`）
- Claude Max plan 訂閱
- Discord Bot Token（從 [Discord Developer Portal](https://discord.com/developers/applications) 建立）

## 安裝

```bash
git clone https://github.com/hsiangfeng/Claude-by-Discord.git
cd Claude-by-Discord
pnpm install
```

## 設定

### 1. 建立 Discord Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. 左側 **Bot** → **Reset Token** → 複製 Token
3. 記下 **Application ID**（即 Client ID）
4. 在 Bot 頁面啟用 **Message Content Intent**（Privileged Gateway Intents 區塊）

### 2. 邀請 Bot 到伺服器

替換 `CLIENT_ID` 後在瀏覽器開啟：

```text
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=326417591296
```

所需權限：Send Messages、Send Messages in Threads、Create Public Threads、Embed Links、Read Message History、Use Slash Commands

### 3. 取得 Discord ID

在 Discord 啟用開發者模式（設定 → 進階 → 開發者模式），然後右鍵複製：

- 伺服器 ID → `DISCORD_GUILD_ID`
- 頻道 ID → `DISCORD_CHANNEL_ID`
- 使用者 ID → `ALLOWED_USER_IDS`

### 4. 環境變數

```bash
cp .env.example .env
```

編輯 `.env`：

```env
DISCORD_BOT_TOKEN=           # Discord Bot Token
DISCORD_CLIENT_ID=           # Discord Application Client ID
DISCORD_GUILD_ID=            # 伺服器 ID
DISCORD_CHANNEL_ID=          # Bot 只在此頻道及其 Thread 中運作
ALLOWED_USER_IDS=            # 允許操作的使用者 ID（多人以逗號分隔）
```

以下為選填，有預設值：

```env
DEFAULT_MODEL=claude-opus-4-6
DEFAULT_PERMISSION_MODE=default
DEFAULT_CWD=
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=5
```

| 變數 | 說明 | 預設值 |
| ------ | ------ | ------ |
| `DEFAULT_MODEL` | `/prompt` 未指定模型時使用的模型。可選 `claude-opus-4-6`、`claude-sonnet-4-5-20250929`、`claude-haiku-4-5-20251001` | `claude-opus-4-6` |
| `DEFAULT_PERMISSION_MODE` | 工具權限的預設處理方式（見下方說明） | `default` |
| `DEFAULT_CWD` | `/prompt` 的預設工作目錄，必須是 `projects.json` 中的路徑。未設定則 fallback 到 `projects.json` 第一個專案 | — |
| `RATE_LIMIT_WINDOW_MS` | 限流時間視窗（毫秒） | `60000`（1 分鐘） |
| `RATE_LIMIT_MAX_REQUESTS` | 每位使用者在時間視窗內可發送的 `/prompt` 次數上限 | `5` |

**權限模式說明：**

| 模式 | 行為 |
| ------ | ------ |
| `default` | 依據專案 `.claude/settings.local.json` 的 allow list 自動放行已列入的工具，其餘透過 Discord 按鈕請求審批 |
| `acceptEdits` | 在 `default` 基礎上，額外自動放行檔案編輯類操作（Write、Edit 等），不需逐一審批 |
| `bypassPermissions` | 自動放行所有工具，不做任何審批。**請謹慎使用** |

### 5. 專案清單

```bash
cp projects.example.json projects.json
```

編輯 `projects.json`，定義可操作的專案路徑：

```json
[
  { "name": "my-project", "path": "/path/to/my-project" },
  { "name": "another-project", "path": "/path/to/another-project" }
]
```

`/prompt` 的 `cwd` 參數會以下拉選單顯示這些專案。每個專案可在其目錄下放置 `.claude/settings.local.json`，定義允許自動執行的工具；不在清單中的操作會透過 Discord 按鈕請求審批。

## 啟動

```bash
# 註冊 Slash Commands（首次或指令有變動時執行）
pnpm deploy-commands

# 啟動 Bot
pnpm dev
```

## 使用方式

### 傳送指令

```text
/prompt message:修好登入頁面的 CSS 問題 cwd:my-project
```

| 參數 | 說明 | 必填 |
| ------ | ------ | ------ |
| `message` | 傳給 Claude 的提示 | 是 |
| `cwd` | 工作目錄（從 projects.json 下拉選擇） | 是 |
| `model` | 模型（Opus 4.6 / Sonnet 4.5 / Haiku 4.5） | 否 |

Bot 自動建立 Thread，所有操作記錄都在 Thread 內即時顯示。

### 續問

Claude 完成一輪後，直接在 Thread 中打字即可續問，Session 會自動 resume，保留完整上下文。可附加圖片、PDF 或文字檔。

### 審批工具

當 Claude 需要執行未放行的操作時，Thread 中會出現權限請求與按鈕：

- **核准** — Claude 繼續執行
- **拒絕** — Claude 調整策略

### 互動式問答

Claude 使用 `AskUserQuestion` 提問時，Bot 顯示選項按鈕。支援單選直接點擊、多選勾選後送出、或點「其他」開啟 Modal 輸入自訂回答。多題會逐題呈現。

### 其他指令

| 指令 | 說明 |
| ------ | ------ |
| `/status` | 查看執行狀態與 Token 統計 |
| `/stop` | 顯示進度摘要，確認後中斷任務並封存 Thread |
| `/history` | 匯出 Session 完整對話紀錄（Markdown 檔案） |
| `/retry` | 用相同 prompt 重新執行（全新 Session） |

## 安全模型

三層防線：

1. **Discord 授權** — 只有 `ALLOWED_USER_IDS` 的使用者可在 `DISCORD_CHANNEL_ID` 操作
2. **專案白名單** — `cwd` 必須在 `projects.json` 中，確保載入正確的專案設定
3. **工具審批** — 專案 `.claude/settings.local.json` 定義自動放行的工具，其餘經 Discord 按鈕審批

> **注意**：`cwd` 限制的是 Claude 的起始工作目錄與載入的設定檔，不是檔案系統存取範圍。Claude 仍可透過絕對路徑存取其他位置。實際防線是各專案的 allow list 與 `canUseTool` 審批流程。

## 架構

```text
src/
├── commands/    # Slash Command 定義（prompt, stop, status, history, retry）
├── handlers/    # 協調層（互動路由、串流處理、權限橋接、續問處理）
├── modules/     # 純函式（Embed 建構、格式化、權限檢查、工具顯示）
├── effects/     # 副作用（Discord I/O、Claude SDK、狀態管理、Logger）
├── config.ts    # 環境變數解析與驗證
├── types.ts     # 型別定義
└── index.ts     # 入口
```

核心機制：`canUseTool` callback 建立 Promise 並將 resolve 存入 StateStore，SDK 暫停等待；使用者在 Discord 點擊按鈕後 resolve Promise，SDK 繼續執行。

## 開發

```bash
pnpm dev              # 開發模式（tsx）
pnpm build            # 編譯 TypeScript
pnpm start            # 執行編譯後版本
pnpm deploy-commands  # 註冊 Slash Commands
pnpm test             # 執行測試（vitest）
pnpm test:watch       # 測試監聽模式
```

## 限制

- Bot 在本機執行，需保持終端機開啟
- 只在指定頻道運作，只有白名單使用者可操作
- Session 狀態存在記憶體中，Bot 重啟後清空
- Claude Code CLI 必須已登入

## License

MIT
