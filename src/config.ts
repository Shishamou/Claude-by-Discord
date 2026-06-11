import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotConfig, ChannelConfig, EffortLevel, PermissionMode } from './types.js';

const VALID_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
];

const VALID_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];

/**
 * 解析環境變數為 BotConfig 物件
 * @param env - 環境變數鍵值對
 * @returns 解析後的 Bot 設定
 */
export function parseConfig(env: Record<string, string | undefined>): BotConfig {
  return {
    discordToken: env.DISCORD_BOT_TOKEN ?? '',
    discordGuildId: env.DISCORD_GUILD_ID ?? '',
    defaultModel: env.DEFAULT_MODEL ?? 'claude-opus-4-6',
    // 直接保留原始字串（轉型），交由 validateConfig 驗證是否為合法值
    defaultEffort: env.DEFAULT_EFFORT ? (env.DEFAULT_EFFORT as EffortLevel) : null,
    defaultPermissionMode: parsePermissionMode(env.DEFAULT_PERMISSION_MODE),
    maxMessageLength: 2000,
    streamUpdateIntervalMs: 2000,
    rateLimitWindowMs: safeParseInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMaxRequests: safeParseInt(env.RATE_LIMIT_MAX_REQUESTS, 5),
    channels: loadChannels(),
  };
}

/**
 * 驗證設定，回傳錯誤訊息陣列（空陣列表示通過）
 * @param config - 要驗證的 Bot 設定
 * @returns 錯誤訊息陣列（空陣列表示驗證通過）
 */
export function validateConfig(config: BotConfig): string[] {
  const errors: string[] = [];

  if (!config.discordToken) {
    errors.push('DISCORD_BOT_TOKEN 未設定');
  }
  if (!config.discordGuildId) {
    errors.push('DISCORD_GUILD_ID 未設定');
  }
  if (config.channels.length === 0) {
    errors.push('channels.json 未設定或為空（至少需要一個頻道設定）');
  }

  const seenChannelIds = new Set<string>();
  for (const channel of config.channels) {
    if (seenChannelIds.has(channel.channelId)) {
      errors.push(`channels.json 中的 channelId "${channel.channelId}" 重複`);
    }
    seenChannelIds.add(channel.channelId);
  }

  if (config.defaultEffort !== null && !VALID_EFFORT_LEVELS.includes(config.defaultEffort)) {
    errors.push(
      `DEFAULT_EFFORT "${config.defaultEffort}" 無效（必須為 low | medium | high | max）`,
    );
  }

  return errors;
}

function safeParseInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parsePermissionMode(value: string | undefined): PermissionMode {
  if (value && VALID_PERMISSION_MODES.includes(value as PermissionMode)) {
    return value as PermissionMode;
  }
  return 'default';
}

/**
 * 載入頻道設定清單（channels.json）
 * @param filePath - 選填的檔案路徑（預設為 channels.json）
 * @returns 頻道設定列表（無效項目會被丟棄）
 */
export function loadChannels(filePath?: string): ChannelConfig[] {
  const path = filePath ?? resolve(process.cwd(), 'channels.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(isValidChannelConfig);
  } catch {
    return [];
  }
}

function isValidChannelConfig(item: unknown): item is ChannelConfig {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;

  const hasRequiredStrings = (['channelId', 'name', 'path'] as const).every(
    (key) => typeof record[key] === 'string' && (record[key] as string).length > 0,
  );
  if (!hasRequiredStrings) return false;

  const isOptionalString = (value: unknown): boolean =>
    value === undefined || value === null || typeof value === 'string';
  if (
    !isOptionalString(record.prompt) ||
    !isOptionalString(record.help) ||
    !isOptionalString(record.model)
  ) {
    return false;
  }

  if (
    record.effort !== undefined &&
    record.effort !== null &&
    !VALID_EFFORT_LEVELS.includes(record.effort as EffortLevel)
  ) {
    return false;
  }

  return true;
}
