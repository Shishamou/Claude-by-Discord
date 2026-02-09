import { describe, it, expect } from 'vitest';
import { isUserAuthorized, isChannelAuthorized, canExecuteCommand, isAllowedCwd } from './permissions.js';
import type { BotConfig, Project } from '../types.js';

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

describe('isChannelAuthorized', () => {
  it('頻道 ID 相符回傳 true', () => {
    expect(isChannelAuthorized('ch1', 'ch1')).toBe(true);
  });

  it('父頻道 ID 相符回傳 true（Thread）', () => {
    expect(isChannelAuthorized('thread1', 'ch1', 'ch1')).toBe(true);
  });

  it('都不相符回傳 false', () => {
    expect(isChannelAuthorized('ch2', 'ch1', 'ch3')).toBe(false);
  });
});

describe('canExecuteCommand', () => {
  const config = {
    allowedUserIds: ['user1'],
    discordChannelId: 'ch1',
  } as BotConfig;

  it('使用者和頻道都符合時允許', () => {
    const result = canExecuteCommand('user1', 'ch1', config);
    expect(result.allowed).toBe(true);
  });

  it('使用者不符時拒絕', () => {
    const result = canExecuteCommand('user2', 'ch1', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('權限');
  });

  it('頻道不符時拒絕', () => {
    const result = canExecuteCommand('user1', 'ch2', config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('頻道');
  });

  it('Thread 的父頻道符合時允許', () => {
    const result = canExecuteCommand('user1', 'thread1', config, 'ch1');
    expect(result.allowed).toBe(true);
  });
});

describe('isAllowedCwd', () => {
  const projects: Project[] = [
    { name: 'project-a', path: '/home/user/project-a' },
    { name: 'project-b', path: '/home/user/project-b' },
  ];

  it('路徑在專案清單中回傳 true', () => {
    expect(isAllowedCwd('/home/user/project-a', projects)).toBe(true);
  });

  it('路徑不在專案清單中回傳 false', () => {
    expect(isAllowedCwd('/home/user/other', projects)).toBe(false);
  });

  it('空專案清單回傳 false', () => {
    expect(isAllowedCwd('/home/user/project-a', [])).toBe(false);
  });

  it('子路徑不算相符', () => {
    expect(isAllowedCwd('/home/user/project-a/src', projects)).toBe(false);
  });
});
