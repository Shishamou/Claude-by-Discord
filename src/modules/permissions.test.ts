import { describe, it, expect } from 'vitest';
import { resolveChannelConfig, canExecuteCommand } from './permissions.js';
import type { BotConfig, ChannelConfig } from '../types.js';

const channels: ChannelConfig[] = [
  { channelId: 'ch1', name: 'project-a', path: '/home/user/project-a' },
  { channelId: 'ch2', name: 'project-b', path: '/home/user/project-b', effort: 'high' },
];

describe('resolveChannelConfig', () => {
  it('頻道 ID 相符回傳對應設定', () => {
    const channel = resolveChannelConfig('ch1', null, channels);
    expect(channel?.name).toBe('project-a');
  });

  it('父頻道 ID 相符回傳對應設定（Thread）', () => {
    const channel = resolveChannelConfig('thread1', 'ch2', channels);
    expect(channel?.name).toBe('project-b');
  });

  it('都不相符回傳 null', () => {
    expect(resolveChannelConfig('ch9', 'ch8', channels)).toBeNull();
  });

  it('parentChannelId 為 undefined 時仍可比對頻道 ID', () => {
    const channel = resolveChannelConfig('ch2', undefined, channels);
    expect(channel?.name).toBe('project-b');
  });

  it('空清單回傳 null', () => {
    expect(resolveChannelConfig('ch1', null, [])).toBeNull();
  });
});

describe('canExecuteCommand', () => {
  const config = { channels } as BotConfig;

  it('頻道符合時允許，並回傳頻道設定', () => {
    const result = canExecuteCommand('ch1', config);
    expect(result.allowed).toBe(true);
    expect(result.channel?.name).toBe('project-a');
  });

  it('頻道不符時拒絕', () => {
    const result = canExecuteCommand('ch9', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('頻道');
    expect(result.channel).toBeUndefined();
  });

  it('Thread 的父頻道符合時允許', () => {
    const result = canExecuteCommand('thread1', config, 'ch2');
    expect(result.allowed).toBe(true);
    expect(result.channel?.name).toBe('project-b');
  });
});
