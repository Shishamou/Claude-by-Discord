import { describe, it, expect } from 'vitest';
import { UsageStore } from './usage-store.js';
import type { TokenUsage } from '../types.js';

function makeUsage(input: number, output: number): TokenUsage {
  return { input, output, cacheRead: 0, cacheWrite: 0, total: input + output, costUsd: 0 };
}

describe('UsageStore', () => {
  it('初始狀態為零', () => {
    const store = new UsageStore();
    const stats = store.getGlobalStats();
    expect(stats.totalSessions).toBe(0);
    expect(stats.completedQueries).toBe(0);
    expect(stats.totalUsage.total).toBe(0);
    expect(stats.totalCostUsd).toBe(0);
  });

  it('recordSessionStart 增加 session 計數', () => {
    const store = new UsageStore();
    store.recordSessionStart();
    store.recordSessionStart();
    expect(store.getGlobalStats().totalSessions).toBe(2);
  });

  it('recordResult 累加全域用量', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    store.recordResult('t2', makeUsage(200, 100), 0.02, 3000);

    const stats = store.getGlobalStats();
    expect(stats.completedQueries).toBe(2);
    expect(stats.totalUsage.input).toBe(300);
    expect(stats.totalUsage.output).toBe(150);
    expect(stats.totalUsage.total).toBe(450);
    expect(stats.totalCostUsd).toBeCloseTo(0.03);
    expect(stats.totalDurationMs).toBe(8000);
  });

  it('recordResult 累加同一 session 用量', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    store.recordResult('t1', makeUsage(200, 100), 0.02, 3000);

    const session = store.getSessionUsage('t1');
    expect(session).toBeDefined();
    expect(session!.usage.input).toBe(300);
    expect(session!.usage.output).toBe(150);
    expect(session!.costUsd).toBeCloseTo(0.03);
    expect(session!.durationMs).toBe(8000);
  });

  it('getSessionUsage 不存在時回傳 undefined', () => {
    const store = new UsageStore();
    expect(store.getSessionUsage('nonexistent')).toBeUndefined();
  });

  it('getGlobalStats 回傳副本', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    const stats = store.getGlobalStats();
    stats.totalUsage.input = 999;
    expect(store.getGlobalStats().totalUsage.input).toBe(100);
  });

  it('getSessionUsage 回傳副本', () => {
    const store = new UsageStore();
    store.recordResult('t1', makeUsage(100, 50), 0.01, 5000);
    const session = store.getSessionUsage('t1')!;
    session.usage.input = 999;
    expect(store.getSessionUsage('t1')!.usage.input).toBe(100);
  });

  it('bootedAt 在建立時設定', () => {
    const before = new Date();
    const store = new UsageStore();
    const stats = store.getGlobalStats();
    expect(stats.bootedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(stats.bootedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });
});
