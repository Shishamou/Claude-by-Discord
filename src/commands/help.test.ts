import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { BotConfig, ChannelConfig } from '../types.js';
import { buildDefaultHelp, loadHelpContent, splitMessage, execute } from './help.js';

vi.mock('../effects/discord-sender.js', () => ({
  deferReplyEphemeral: vi.fn().mockResolvedValue(undefined),
  editReply: vi.fn().mockResolvedValue(undefined),
}));

import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';

const tmpDir = mkdtempSync(join(tmpdir(), 'help-test-'));

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeConfig(channels: ChannelConfig[]): BotConfig {
  return {
    discordToken: 'token',
    discordGuildId: 'guild',
    defaultModel: 'claude-opus-4-6',
    defaultEffort: null,
    defaultPermissionMode: 'default',
    maxMessageLength: 2000,
    streamUpdateIntervalMs: 2000,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 5,
    channels,
  };
}

describe('buildDefaultHelp', () => {
  it('包含頻道名稱、路徑與使用方式', () => {
    const channel: ChannelConfig = { channelId: 'ch1', name: 'my-proj', path: '/proj' };
    const content = buildDefaultHelp(channel, makeConfig([channel]));
    expect(content).toContain('my-proj');
    expect(content).toContain('/proj');
    expect(content).toContain('claude-opus-4-6');
    expect(content).toContain('/status');
    expect(content).toContain('🛑');
  });

  it('顯示頻道覆寫的模型與 effort', () => {
    const channel: ChannelConfig = {
      channelId: 'ch1',
      name: 'p',
      path: '/p',
      model: 'claude-sonnet-4-5-20250929',
      effort: 'high',
    };
    const content = buildDefaultHelp(channel, makeConfig([channel]));
    expect(content).toContain('claude-sonnet-4-5-20250929');
    expect(content).toContain('high');
    expect(content).not.toContain('claude-opus-4-6');
  });
});

describe('loadHelpContent', () => {
  it('未設定 help 時回傳內建說明', () => {
    const channel: ChannelConfig = { channelId: 'ch1', name: 'p', path: '/p' };
    const content = loadHelpContent(channel, makeConfig([channel]));
    expect(content).toContain('使用說明');
  });

  it('讀取絕對路徑的 help 文件', () => {
    const helpPath = join(tmpDir, 'abs-help.md');
    writeFileSync(helpPath, '# 自訂說明\n這是文件內容');
    const channel: ChannelConfig = { channelId: 'ch1', name: 'p', path: '/p', help: helpPath };
    const content = loadHelpContent(channel, makeConfig([channel]));
    expect(content).toBe('# 自訂說明\n這是文件內容');
  });

  it('相對路徑以頻道 path 為基準', () => {
    writeFileSync(join(tmpDir, 'rel-help.md'), '相對路徑內容');
    const channel: ChannelConfig = { channelId: 'ch1', name: 'p', path: tmpDir, help: 'rel-help.md' };
    const content = loadHelpContent(channel, makeConfig([channel]));
    expect(content).toBe('相對路徑內容');
  });

  it('文件不存在時回傳警告 + 內建說明', () => {
    const channel: ChannelConfig = {
      channelId: 'ch1',
      name: 'p',
      path: tmpDir,
      help: 'missing.md',
    };
    const content = loadHelpContent(channel, makeConfig([channel]));
    expect(content).toContain('⚠️ 無法讀取');
    expect(content).toContain('使用說明');
  });

  it('文件為空時回退到內建說明', () => {
    writeFileSync(join(tmpDir, 'empty.md'), '   \n  ');
    const channel: ChannelConfig = { channelId: 'ch1', name: 'p', path: tmpDir, help: 'empty.md' };
    const content = loadHelpContent(channel, makeConfig([channel]));
    expect(content).toContain('使用說明');
  });
});

describe('splitMessage', () => {
  it('短文字回傳單段', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('長文字依行切分且每段不超過 2000 字', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line-${i}-${'x'.repeat(50)}`).join('\n');
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    expect(chunks.join('\n')).toBe(text);
  });

  it('單行超過 2000 字時硬切', () => {
    const text = 'y'.repeat(4500);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(text);
  });
});

describe('execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeInteraction(channelId: string, parentId: string | null = null) {
    return {
      channelId,
      channel: { isThread: () => parentId !== null, parentId },
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown;
  }

  it('未設定的頻道回覆錯誤', async () => {
    const config = makeConfig([{ channelId: 'ch1', name: 'p', path: '/p' }]);
    const interaction = makeInteraction('ch-x');
    await execute(interaction as never, config);
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: [MessageFlags.Ephemeral] }),
    );
    expect(editReply).not.toHaveBeenCalled();
  });

  it('設定頻道內回覆內建說明', async () => {
    const config = makeConfig([{ channelId: 'ch1', name: 'proj', path: '/p' }]);
    const interaction = makeInteraction('ch1');
    await execute(interaction as never, config);
    expect(deferReplyEphemeral).toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ content: expect.stringContaining('proj') }),
    );
  });

  it('Thread 內以父頻道解析設定', async () => {
    const config = makeConfig([{ channelId: 'ch1', name: 'proj', path: '/p' }]);
    const interaction = makeInteraction('thread-1', 'ch1');
    await execute(interaction as never, config);
    expect(editReply).toHaveBeenCalled();
  });

  it('超長內容以 followUp 分段發送', async () => {
    const helpPath = join(tmpDir, 'long-help.md');
    writeFileSync(helpPath, Array.from({ length: 80 }, () => 'z'.repeat(60)).join('\n'));
    const config = makeConfig([
      { channelId: 'ch1', name: 'p', path: '/p', help: helpPath },
    ]);
    const interaction = makeInteraction('ch1');
    await execute(interaction as never, config);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect((interaction as Record<string, unknown>).followUp).toHaveBeenCalled();
  });
});
