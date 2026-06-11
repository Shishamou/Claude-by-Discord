# Discord Claude Bot

從 Discord 遠端操控本機 Claude Code。不需要待在電腦前，用手機打開 Discord 就能下指令、審批工具、追蹤進度。

## 運作原理

透過 [`@anthropic-ai/claude-agent-sdk`](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) 在本機生成 Claude Code 子程序執行任務，再將過程即時串流到 Discord Thread。

- **使用本機 CLI 登入狀態** — SDK 直接沿用 `claude login` 的認證，不需額外設定 API Key
- **本機必須持續運行** — Bot 停了就無法遠端操控

> **注意**：本專案僅以 Claude Code 訂閱（Max plan）測試。若你使用 API Key 登入 CLI，理論上可運作但**尚未經過測試**，且會消耗 API 額度。

## 功能

- **頻道對應專案** — 每個 Discord 頻道在 `channels.json` 綁定一個專案目錄，可選擇性覆寫提示詞、模型與推理深度（effort）
- **@mention 開啟任務** — 在已設定的頻道 @ 標注 Bot 即建立 Thread 並啟動 Claude Code Session
- **即時串流** — Claude 的回應以 2 秒節流即時更新，不需等完整回應
- **Thread 隔離** — 每次 @mention 建立獨立 Thread，支援同時執行多個任務
- **續問對話** — 在 Thread 中直接打字即可續問，保留完整對話歷史
- **工具審批** — 未放行的工具操作透過 Discord 按鈕請求核准/拒絕
- **互動式問答** — Claude 的 `AskUserQuestion` 以按鈕顯示，支援單選、多選、自訂回答
- **檔案上傳** — @mention 與續問時可附加圖片、PDF、文字檔，Claude 直接讀取
- **🛑 一鍵中斷** — 每輪完成通知附帶中斷按鈕，點擊即停止並印出可供 `claude -r` 還原的 Session ID
- **閒置自動中止** — Thread 超過 30 分鐘無新對話自動中止
- **Token 追蹤** — 累計 Token 消耗與 USD 成本，`/status` 查看統計

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
- 頻道 ID → `channels.json` 的 `channelId`（見下方「頻道設定」）

> 存取控制由 Discord 頻道權限把關：能在設定頻道發言的人即可操作 Bot，不再維護使用者白名單。

### 4. 環境變數

```bash
cp .env.example .env
```

編輯 `.env`：

```env
DISCORD_BOT_TOKEN=           # Discord Bot Token
DISCORD_CLIENT_ID=           # Discord Application Client ID
DISCORD_GUILD_ID=            # 伺服器 ID
```

以下為選填，有預設值：

```env
DEFAULT_MODEL=claude-opus-4-6
DEFAULT_EFFORT=
DEFAULT_PERMISSION_MODE=default
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=5
```

| 變數 | 說明 | 預設值 |
| ------ | ------ | ------ |
| `DEFAULT_MODEL` | 頻道未覆寫 `model` 時使用的模型。可選 `claude-opus-4-6`、`claude-sonnet-4-5-20250929`、`claude-haiku-4-5-20251001` | `claude-opus-4-6` |
| `DEFAULT_EFFORT` | 頻道未覆寫 `effort` 時使用的推理深度，必須為 `low` / `medium` / `high` / `max`（設定其他值會啟動失敗）。未設定則交由 Claude Code CLI 預設 | — |
| `DEFAULT_PERMISSION_MODE` | 工具權限的預設處理方式（見下方說明） | `default` |
| `RATE_LIMIT_WINDOW_MS` | 限流時間視窗（毫秒）（保留設定，現行 @mention 流程未啟用） | `60000`（1 分鐘） |
| `RATE_LIMIT_MAX_REQUESTS` | 時間視窗內的請求上限（保留設定，現行 @mention 流程未啟用） | `5` |

**權限模式說明：**

| 模式 | 行為 |
| ------ | ------ |
| `default` | 依據專案 `.claude/settings.local.json` 的 allow list 自動放行已列入的工具，其餘透過 Discord 按鈕請求審批 |
| `acceptEdits` | 在 `default` 基礎上，額外自動放行檔案編輯類操作（Write、Edit 等），不需逐一審批 |
| `bypassPermissions` | 自動放行所有工具，不做任何審批。**請謹慎使用** |

### 5. 頻道設定

```bash
cp channels.example.json channels.json
```

編輯 `channels.json`（已加入 `.gitignore`，不會被提交），將每個 Discord 頻道對應到一個專案：

```json
[
  {
    "channelId": "123456789012345678",
    "name": "my-project",
    "path": "/path/to/my-project",
    "prompt": "你是 my-project 專案助手，回覆請使用正體中文。",
    "model": "claude-sonnet-4-5-20250929",
    "effort": "high"
  },
  {
    "channelId": "234567890123456789",
    "name": "another-project",
    "path": "/path/to/another-project"
  }
]
```

| 欄位 | 說明 | 必填 |
| ------ | ------ | ------ |
| `channelId` | Discord 頻道 ID，一個頻道只能對應一個設定 | 是 |
| `name` | 顯示名稱（啟動 banner 與日誌用） | 是 |
| `path` | 從此頻道啟動的 Claude Code Session 的工作目錄（cwd） | 是 |
| `prompt` | 頻道提示詞。**僅在開新 Thread 的首輪對話**前置於使用者訊息之前；Thread 內續問不會重複前置。`null` 或省略表示不使用 | 否 |
| `model` | 此頻道的模型覆寫。`null` 或省略則 fallback 到 `DEFAULT_MODEL` | 否 |
| `effort` | 此頻道的推理深度覆寫（`low` / `medium` / `high` / `max`）。`null` 或省略則 fallback 到 `DEFAULT_EFFORT`；兩者皆未設定則交由 CLI 預設 | 否 |

Bot 只回應 `channels.json` 中列出的頻道（及其 Thread）。每個專案可在其目錄下放置 `.claude/settings.local.json`，定義允許自動執行的工具；不在清單中的操作會透過 Discord 按鈕請求審批。

## 啟動

```bash
# 註冊 Slash Commands（首次或指令有變動時執行）
pnpm deploy-commands

# 啟動 Bot
pnpm dev
```

## 使用方式

### 開始任務

在 `channels.json` 設定的頻道中 @ 標注 Bot 並描述任務：

```text
@ClaudeBot 修好登入頁面的 CSS 問題
```

Bot 會以該訊息建立 Thread 並啟動 Session：工作目錄取自頻道的 `path`，模型與推理深度依「頻道覆寫 → 全域預設」決定，頻道 `prompt` 會前置於首輪訊息。所有操作記錄都在 Thread 內即時顯示。可附加圖片、PDF 或文字檔。

任務完成後不再發送統計摘要，Bot 會以一則純文字訊息通知並附帶 🛑 中斷按鈕：`✅ @你 任務完成，可在此 Thread 繼續對話。`

> Session 開始時不再發送「Session 開始」訊息；Skill 與 Bash 工具呼叫也不輸出，以降低 Thread 雜訊（其餘工具如 Edit、Write、Read 仍會顯示）。

### 續問

Claude 完成一輪後，直接在 Thread 中打字即可續問，Session 會自動 resume，保留完整上下文。可附加圖片、PDF 或文字檔。續問不會重複前置頻道 `prompt`。

### 中斷任務

每輪完成通知附帶 🛑 中斷按鈕，點擊即直接中止（不再二次確認）：Bot 會中斷查詢、印出 Session ID 與 `claude -r <id>` 還原指令，並封存 Thread。

此外，Thread 超過 30 分鐘無新對話會自動中止，同樣印出還原指令後封存。

### 審批工具

當 Claude 需要執行未放行的操作時，Thread 中會出現權限請求與按鈕：

- **核准** — Claude 繼續執行
- **拒絕** — Claude 調整策略

### 互動式問答

Claude 使用 `AskUserQuestion` 提問時，Bot 顯示選項按鈕。支援單選直接點擊、多選勾選後送出、或點「其他」開啟 Modal 輸入自訂回答。多題會逐題呈現。

### Slash 指令

唯一保留的 Slash 指令：

| 指令 | 說明 |
| ------ | ------ |
| `/status` | 查看執行狀態與 Token 統計 |

## 安全模型

三層防線：

1. **Discord 頻道權限** — 存取控制由 Discord 頻道權限把關：只在 `channels.json` 列出的頻道（及其 Thread）中生效，能在該頻道發言的人即可操作。請用 Discord 的頻道權限限制可見/可發言的成員
2. **頻道白名單** — 工作目錄固定為頻道設定的 `path`，確保載入正確的專案設定
3. **工具審批** — 視 `DEFAULT_PERMISSION_MODE` 而定：`default`/`acceptEdits` 經 Discord 按鈕審批未放行的操作；`bypassPermissions` 則全部放行（適合受信任的私人頻道）

> **注意**：`path` 限制的是 Claude 的起始工作目錄與載入的設定檔，不是檔案系統存取範圍。Claude 仍可透過絕對路徑存取其他位置。實際防線是各專案的 allow list 與 `canUseTool` 審批流程。

## 架構

```text
src/
├── commands/    # Slash Command 定義（status）與中斷邏輯（stop）
├── handlers/    # 協調層（互動路由、@mention 處理、串流處理、權限橋接、續問處理）
├── modules/     # 純函式（Embed 建構、格式化、權限檢查、工具顯示）
├── effects/     # 副作用（Discord I/O、Claude SDK、狀態管理、Logger）
├── config.ts    # 環境變數與 channels.json 解析驗證
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
- 只在 `channels.json` 設定的頻道運作，存取由 Discord 頻道權限把關
- Session 狀態存在記憶體中，Bot 重啟後清空
- Claude Code CLI 必須已登入

## License

MIT
