import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BotConfig, PermissionMode, Project } from './types.js';

const VALID_PERMISSION_MODES: PermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
];

/**
 * 解析環境變數為 BotConfig 物件
 * @param env - 環境變數鍵值對
 * @returns 解析後的 Bot 設定
 */
export function parseConfig(env: Record<string, string | undefined>): BotConfig {
  const projects = loadProjects();
  return {
    discordToken: env.DISCORD_BOT_TOKEN ?? '',
    discordGuildId: env.DISCORD_GUILD_ID ?? '',
    discordChannelId: env.DISCORD_CHANNEL_ID ?? '',
    allowedUserIds: parseCommaSeparated(env.ALLOWED_USER_IDS),
    defaultCwd: env.DEFAULT_CWD || projects[0]?.path || process.cwd(),
    defaultModel: env.DEFAULT_MODEL ?? 'claude-opus-4-6',
    defaultPermissionMode: parsePermissionMode(env.DEFAULT_PERMISSION_MODE),
    maxMessageLength: 2000,
    streamUpdateIntervalMs: 2000,
    rateLimitWindowMs: safeParseInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMaxRequests: safeParseInt(env.RATE_LIMIT_MAX_REQUESTS, 5),
    projects,
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
  if (!config.discordChannelId) {
    errors.push('DISCORD_CHANNEL_ID 未設定');
  }
  if (config.allowedUserIds.length === 0) {
    errors.push('ALLOWED_USER_IDS 未設定（至少需要一個允許的使用者 ID）');
  }
  if (config.projects.length === 0) {
    errors.push('projects.json 未設定或為空（至少需要一個專案）');
  }
  if (config.projects.length > 0 && !config.projects.some((p) => p.path === config.defaultCwd)) {
    errors.push(`DEFAULT_CWD "${config.defaultCwd}" 不在 projects.json 的允許路徑中`);
  }

  return errors;
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
 * 載入專案清單（projects.json）
 * @param filePath - 選填的檔案路徑（預設為 projects.json）
 * @returns 專案列表
 */
export function loadProjects(filePath?: string): Project[] {
  const path = filePath ?? resolve(process.cwd(), 'projects.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as unknown[];
    return data.filter(
      (item): item is Project =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>).name === 'string' &&
        typeof (item as Record<string, unknown>).path === 'string',
    );
  } catch {
    return [];
  }
}
