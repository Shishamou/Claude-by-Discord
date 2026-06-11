import { describe, it, expect } from 'vitest';
import { isUserAuthorized, resolveChannelConfig, canExecuteCommand } from './permissions.js';
import type { BotConfig, ChannelConfig } from '../types.js';

const channels: ChannelConfig[] = [
  { channelId: 'ch1', name: 'project-a', path: '/home/user/project-a' },
  { channelId: 'ch2', name: 'project-b', path: '/home/user/project-b', effort: 'high' },
];

describe('isUserAuthorized', () => {
  it('在允許名單中回傳 true', () => {
    expect(isUserAuthorized('123', ['123', '456'])).toBe(true);
  });

  it('不在允許名單中回傳 false', () => {
    expect(isUserAuthorized('789', ['123', '456'])).toBe(false);
  });

  it('空名單回傳 false', () => {
    expect(isUserAuthorized('123', [])).toBe(false);
  });
});

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
  const config = {
    allowedUserIds: ['user1'],
    channels,
  } as BotConfig;

  it('使用者和頻道都符合時允許，並回傳頻道設定', () => {
    const result = canExecuteCommand('user1', 'ch1', config);
    expect(result.allowed).toBe(true);
    expect(result.channel?.name).toBe('project-a');
  });

  it('使用者不符時拒絕', () => {
    const result = canExecuteCommand('user2', 'ch1', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('權限');
    expect(result.channel).toBeUndefined();
  });

  it('頻道不符時拒絕', () => {
    const result = canExecuteCommand('user1', 'ch9', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('頻道');
    expect(result.channel).toBeUndefined();
  });

  it('Thread 的父頻道符合時允許', () => {
    const result = canExecuteCommand('user1', 'thread1', config, 'ch2');
    expect(result.allowed).toBe(true);
    expect(result.channel?.name).toBe('project-b');
  });
});
