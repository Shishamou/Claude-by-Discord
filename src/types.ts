import type { APIEmbed, APIActionRowComponent, APIButtonComponent } from 'discord.js';

// ─── 頻道設定 ────────────────────────────────────────

/** Claude Code 推理深度（effort），透過 CLAUDE_CODE_EFFORT_LEVEL 環境變數傳遞 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

/** 頻道設定，對應 `channels.json` 中的一筆項目（每個 Discord 頻道對應一個工作目錄） */
export interface ChannelConfig {
  channelId: string;
  name: string;
  path: string;
  /** 開新 Thread 首輪對話時前置的提示詞（續問不重複） */
  prompt?: string | null;
  /** 模型覆寫，null/未設定時 fallback 到 defaultModel */
  model?: string | null;
  /** Effort 覆寫，null/未設定時 fallback 到 defaultEffort */
  effort?: EffortLevel | null;
}

// ─── 設定 ───────────────────────────────────────────

/**
 * Claude Code 權限模式
 * - `default` — SDK 自行判斷安全操作放行，其餘經 Discord 審批
 * - `acceptEdits` — 自動允許檔案編輯
 * - `bypassPermissions` — 略過所有權限檢查
 * - `plan` — 僅允許唯讀操作
 */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** Bot 全域設定，由環境變數與 `channels.json` 組合產生 */
export interface BotConfig {
  discordToken: string;
  discordGuildId: string;
  allowedUserIds: string[];
  defaultModel: string;
  defaultEffort: EffortLevel | null;
  defaultPermissionMode: PermissionMode;
  maxMessageLength: number;
  streamUpdateIntervalMs: number;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  channels: ChannelConfig[];
}

// ─── Session ────────────────────────────────────────

/** Session 生命週期狀態 */
export type SessionStatus =
  | 'idle'
  | 'running'
  | 'awaiting_permission'
  | 'waiting_input'
  | 'completed'
  | 'error';

/** 單一 Claude Code Session 的完整狀態，以 Discord Thread ID 為 key 管理 */
export interface SessionState {
  sessionId: string | null;
  status: SessionStatus;
  threadId: string;
  userId: string;
  startedAt: Date;
  lastActivityAt: Date;
  promptText: string;
  cwd: string;
  model: string;
  effort: EffortLevel | null;
  toolCount: number;
  tools: Record<string, number>;
  pendingApproval: PendingApproval | null;
  abortController: AbortController;
  transcript: TranscriptEntry[];
  attachments?: FileAttachment[];
}

/** 對話紀錄中的單筆條目 */
export interface TranscriptEntry {
  timestamp: Date;
  type: 'assistant' | 'tool_use' | 'result' | 'user' | 'error';
  content: string;
  toolName?: string;
}

/** AskUserQuestion 多問題逐題互動的追蹤狀態 */
export interface AskState {
  totalQuestions: number;
  currentQuestionIndex: number;
  collectedAnswers: Record<string, string>;
  selectedOptions: Set<number>;
  isMultiSelect: boolean;
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>;
}

/**
 * 待審批的工具請求
 *
 * 核心機制：建立 Promise 後將 `resolve` 存入 StateStore，
 * SDK 暫停等待使用者在 Discord 點擊按鈕，點擊後呼叫 `resolve` 解除暫停。
 */
export interface PendingApproval {
  toolName: string;
  toolInput: unknown;
  messageId: string;
  resolve: (result: PermissionResult) => void;
  createdAt: Date;
  askState?: AskState;
}

/** 權限審批結果，由 Discord 按鈕互動產生 */
export interface PermissionResult {
  behavior: 'allow' | 'deny';
  updatedInput?: unknown;
  message?: string;
}

// ─── 檔案附件 ──────────────────────────────────────

/** 附件類型：圖片、文件（PDF）、純文字 */
export type AttachmentType = 'image' | 'document' | 'text';

/** 使用者從 Discord 上傳的檔案附件，已轉為 base64 */
export interface FileAttachment {
  type: AttachmentType;
  base64: string;
  mediaType: string;
  filename: string;
  textContent?: string;
}

/** @deprecated 請改用 {@link FileAttachment} */
export type ImageAttachment = FileAttachment;

// ─── Token ──────────────────────────────────────────

/** 單次或累計的 Token 使用量統計 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
  costUsd: number;
}

// ─── 顯示 ──────────────────────────────────────────

/** 工具使用的格式化顯示資訊，用於建構 Discord Embed */
export interface ToolDisplayInfo {
  title: string;
  description: string;
  fields?: Array<{ name: string; value: string; inline: boolean }>;
}

/** Discord 訊息的組合結構（Embed + 按鈕 + 文字） */
export interface DisplayMessage {
  embeds?: APIEmbed[];
  components?: APIActionRowComponent<APIButtonComponent>[];
  content?: string;
}

// ─── 顏色與 Emoji ──────────────────────────────────

/** Discord Embed 顏色常數 */
export const COLORS = {
  PreToolUse: 0x7289da,
  PostToolUse: 0x43b581,
  PostToolUseFailure: 0xf04747,
  Stop: 0x43b581,
  Notification: 0xfaa61a,
  SessionStart: 0x9b59b6,
  SessionEnd: 0x747f8d,
  Running: 0x3498db,
  Permission: 0xe67e22,
  Error: 0xe74c3c,
  Info: 0x95a5a6,
  WaitingInput: 0x2ecc71,
} as const;

/** 各工具對應的 Emoji 圖示 */
export const TOOL_EMOJI: Record<string, string> = {
  Read: '📖',
  Write: '📝',
  Edit: '✏️',
  Bash: '💻',
  Glob: '🔍',
  Grep: '🔎',
  WebFetch: '🌐',
  WebSearch: '🔍',
  Task: '🤖',
  AskUser: '❓',
  AskUserQuestion: '❓',
  NotebookEdit: '📓',
  EnterPlanMode: '📋',
  ExitPlanMode: '📋',
};

// ─── 權限模式顯示名稱 ──────────────────────────────

/** 權限模式的正體中文顯示名稱對照表 */
export const PERMISSION_MODE_NAMES: Record<string, string> = {
  default: '預設模式',
  plan: '計畫模式',
  acceptEdits: '允許編輯',
  bypassPermissions: '略過權限',
};

// ─── Session 狀態顯示名稱 ──────────────────────────

/** Session 狀態的正體中文顯示名稱對照表 */
export const SESSION_STATUS_NAMES: Record<SessionStatus, string> = {
  idle: '閒置',
  running: '執行中',
  awaiting_permission: '等待審批',
  waiting_input: '等待輸入',
  completed: '已完成',
  error: '錯誤',
};
