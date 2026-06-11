import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterAll } from 'vitest';
import { parseConfig, validateConfig, loadChannels } from './config.js';
import type { BotConfig, ChannelConfig } from './types.js';

describe('parseConfig', () => {
  const minimal = {
    DISCORD_BOT_TOKEN: 'token',
    DISCORD_GUILD_ID: 'guild',
    ALLOWED_USER_IDS: 'user1',
  };

  it('解析基本環境變數', () => {
    const config = parseConfig(minimal);
    expect(config.discordToken).toBe('token');
    expect(config.discordGuildId).toBe('guild');
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
    expect(config.defaultEffort).toBeNull();
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

  it('DEFAULT_EFFORT 保留原始值（含無效值，交由 validateConfig 驗證）', () => {
    expect(parseConfig({ ...minimal, DEFAULT_EFFORT: 'high' }).defaultEffort).toBe('high');
    expect(parseConfig({ ...minimal, DEFAULT_EFFORT: 'banana' }).defaultEffort).toBe('banana');
    expect(parseConfig({ ...minimal, DEFAULT_EFFORT: '' }).defaultEffort).toBeNull();
    expect(parseConfig(minimal).defaultEffort).toBeNull();
  });

  it('缺少 token 時為空字串', () => {
    const config = parseConfig({});
    expect(config.discordToken).toBe('');
    expect(config.discordGuildId).toBe('');
  });
});

describe('validateConfig', () => {
  const channels: ChannelConfig[] = [
    { channelId: 'ch1', name: 'project-a', path: '/home/user/project-a' },
  ];

  /** 建立一份通過驗證的完整設定，再套用覆寫 */
  function makeConfig(overrides: Partial<BotConfig> = {}): BotConfig {
    return {
      ...parseConfig({
        DISCORD_BOT_TOKEN: 'token',
        DISCORD_GUILD_ID: 'guild',
        ALLOWED_USER_IDS: 'user1',
      }),
      channels,
      ...overrides,
    };
  }

  it('完整設定無錯誤', () => {
    expect(validateConfig(makeConfig())).toEqual([]);
  });

  it('缺少 token 產生錯誤', () => {
    const errors = validateConfig(makeConfig({ discordToken: '' }));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('DISCORD_BOT_TOKEN');
  });

  it('channels 為空產生錯誤', () => {
    const errors = validateConfig(makeConfig({ channels: [] }));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('channels.json');
  });

  it('channelId 重複產生錯誤', () => {
    const errors = validateConfig(
      makeConfig({
        channels: [
          { channelId: 'ch1', name: 'a', path: '/a' },
          { channelId: 'ch1', name: 'b', path: '/b' },
        ],
      }),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('ch1');
    expect(errors[0]).toContain('重複');
  });

  it('無效的 defaultEffort 產生錯誤', () => {
    const errors = validateConfig(
      makeConfig({ defaultEffort: 'banana' as BotConfig['defaultEffort'] }),
    );
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('DEFAULT_EFFORT');
  });

  it('有效的 defaultEffort 無錯誤', () => {
    expect(validateConfig(makeConfig({ defaultEffort: 'max' }))).toEqual([]);
  });

  it('所有欄位缺少時產生 4 個錯誤', () => {
    const config = { ...parseConfig({}), channels: [] };
    const errors = validateConfig(config);
    expect(errors.length).toBe(4);
  });
});

describe('loadChannels', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'channels-test-'));

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTmpJson(name: string, content: unknown): string {
    const path = join(tmpDir, name);
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
    return path;
  }

  it('載入有效的頻道設定', () => {
    const path = writeTmpJson('valid.json', [
      { channelId: 'ch1', name: 'a', path: '/a' },
      {
        channelId: 'ch2',
        name: 'b',
        path: '/b',
        prompt: '你是助手',
        model: 'claude-sonnet-4-5-20250929',
        effort: 'high',
      },
    ]);
    const channels = loadChannels(path);
    expect(channels.length).toBe(2);
    expect(channels[0]).toEqual({ channelId: 'ch1', name: 'a', path: '/a' });
    expect(channels[1].effort).toBe('high');
  });

  it('prompt/model/effort 為 null 視為有效', () => {
    const path = writeTmpJson('nulls.json', [
      { channelId: 'ch1', name: 'a', path: '/a', prompt: null, model: null, effort: null },
    ]);
    expect(loadChannels(path).length).toBe(1);
  });

  it('丟棄缺少必填欄位或型別錯誤的項目', () => {
    const path = writeTmpJson('partial.json', [
      { channelId: 'ch1', name: 'a', path: '/a' },
      { channelId: 'ch2', name: 'b' }, // 缺 path
      { channelId: '', name: 'c', path: '/c' }, // channelId 空字串
      { channelId: 'ch4', name: 42, path: '/d' }, // name 非字串
      'not-an-object',
      null,
    ]);
    const channels = loadChannels(path);
    expect(channels.length).toBe(1);
    expect(channels[0].channelId).toBe('ch1');
  });

  it('丟棄 effort 無效的項目', () => {
    const path = writeTmpJson('bad-effort.json', [
      { channelId: 'ch1', name: 'a', path: '/a', effort: 'turbo' },
      { channelId: 'ch2', name: 'b', path: '/b', effort: 'low' },
    ]);
    const channels = loadChannels(path);
    expect(channels.length).toBe(1);
    expect(channels[0].channelId).toBe('ch2');
  });

  it('丟棄 prompt/model 型別錯誤的項目', () => {
    const path = writeTmpJson('bad-optional.json', [
      { channelId: 'ch1', name: 'a', path: '/a', prompt: 123 },
      { channelId: 'ch2', name: 'b', path: '/b', model: ['x'] },
    ]);
    expect(loadChannels(path)).toEqual([]);
  });

  it('檔案不存在回傳空陣列', () => {
    expect(loadChannels(join(tmpDir, 'missing.json'))).toEqual([]);
  });

  it('JSON 格式錯誤回傳空陣列', () => {
    const path = writeTmpJson('broken.json', '{ not json');
    expect(loadChannels(path)).toEqual([]);
  });

  it('非陣列的 JSON 回傳空陣列', () => {
    const path = writeTmpJson('object.json', { channelId: 'ch1' });
    expect(loadChannels(path)).toEqual([]);
  });
});
