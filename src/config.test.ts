import { describe, it, expect } from 'vitest';
import { parseConfig, validateConfig } from './config.js';

describe('parseConfig', () => {
  const minimal = {
    DISCORD_BOT_TOKEN: 'token',
    DISCORD_GUILD_ID: 'guild',
    DISCORD_CHANNEL_ID: 'channel',
    ALLOWED_USER_IDS: 'user1',
  };

  it('解析基本環境變數', () => {
    const config = parseConfig(minimal);
    expect(config.discordToken).toBe('token');
    expect(config.discordGuildId).toBe('guild');
    expect(config.discordChannelId).toBe('channel');
    expect(config.allowedUserIds).toEqual(['user1']);
  });

  it('多個使用者 ID 以逗號分隔', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: 'a, b, c' });
    expect(config.allowedUserIds).toEqual(['a', 'b', 'c']);
  });

  it('尾部逗號不產生空元素', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: 'a,b,' });
    expect(config.allowedUserIds).toEqual(['a', 'b']);
  });

  it('空字串 ALLOWED_USER_IDS 回傳空陣列', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: '' });
    expect(config.allowedUserIds).toEqual([]);
  });

  it('未設定 ALLOWED_USER_IDS 回傳空陣列', () => {
    const config = parseConfig({ ...minimal, ALLOWED_USER_IDS: undefined });
    expect(config.allowedUserIds).toEqual([]);
  });

  it('預設值正確', () => {
    const config = parseConfig(minimal);
    expect(config.defaultModel).toBe('claude-opus-4-6');
    expect(config.defaultPermissionMode).toBe('default');
    expect(config.maxMessageLength).toBe(2000);
    expect(config.streamUpdateIntervalMs).toBe(2000);
    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitMaxRequests).toBe(5);
  });

  it('自訂數值設定', () => {
    const config = parseConfig({
      ...minimal,
      RATE_LIMIT_WINDOW_MS: '30000',
      RATE_LIMIT_MAX_REQUESTS: '10',
    });
    expect(config.rateLimitWindowMs).toBe(30_000);
    expect(config.rateLimitMaxRequests).toBe(10);
  });

  it('非數字環境變數回退到預設值（NaN 防護）', () => {
    const config = parseConfig({
      ...minimal,
      RATE_LIMIT_WINDOW_MS: 'abc',
      RATE_LIMIT_MAX_REQUESTS: 'not_a_number',
    });
    expect(config.rateLimitWindowMs).toBe(60_000);
    expect(config.rateLimitMaxRequests).toBe(5);
  });

  it('有效的 permission mode', () => {
    const config = parseConfig({ ...minimal, DEFAULT_PERMISSION_MODE: 'acceptEdits' });
    expect(config.defaultPermissionMode).toBe('acceptEdits');
  });

  it('無效的 permission mode 回退到 default', () => {
    const config = parseConfig({ ...minimal, DEFAULT_PERMISSION_MODE: 'invalid' });
    expect(config.defaultPermissionMode).toBe('default');
  });

  it('缺少 token 時為空字串', () => {
    const config = parseConfig({});
    expect(config.discordToken).toBe('');
    expect(config.discordGuildId).toBe('');
    expect(config.discordChannelId).toBe('');
  });
});

describe('validateConfig', () => {
  it('完整設定無錯誤', () => {
    const config = parseConfig({
      DISCORD_BOT_TOKEN: 'token',
      DISCORD_GUILD_ID: 'guild',
      DISCORD_CHANNEL_ID: 'channel',
      ALLOWED_USER_IDS: 'user1',
    });
    expect(validateConfig(config)).toEqual([]);
  });

  it('缺少 token 產生錯誤', () => {
    const config = parseConfig({
      DISCORD_GUILD_ID: 'guild',
      DISCORD_CHANNEL_ID: 'channel',
      ALLOWED_USER_IDS: 'user1',
    });
    const errors = validateConfig(config);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('DISCORD_BOT_TOKEN');
  });

  it('所有欄位缺少時產生 4 個錯誤', () => {
    const config = parseConfig({});
    const errors = validateConfig(config);
    expect(errors.length).toBe(4);
  });
});
