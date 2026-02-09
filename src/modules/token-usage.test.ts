import { describe, it, expect } from 'vitest';
import {
  calculateTokenUsage,
  mergeTokenUsage,
  emptyTokenUsage,
  formatTokenUsage,
} from './token-usage.js';

describe('calculateTokenUsage', () => {
  it('從 SDK 回應計算用量', () => {
    const usage = calculateTokenUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    });
    expect(usage.input).toBe(100);
    expect(usage.output).toBe(50);
    expect(usage.cacheRead).toBe(20);
    expect(usage.cacheWrite).toBe(10);
    expect(usage.total).toBe(150);
  });

  it('缺少欄位時預設為 0', () => {
    const usage = calculateTokenUsage({});
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(0);
    expect(usage.cacheRead).toBe(0);
    expect(usage.cacheWrite).toBe(0);
    expect(usage.total).toBe(0);
  });
});

describe('mergeTokenUsage', () => {
  it('合併兩筆用量', () => {
    const a = { input: 100, output: 50, cacheRead: 10, cacheWrite: 5, total: 150, costUsd: 0.01 };
    const b = { input: 200, output: 100, cacheRead: 20, cacheWrite: 10, total: 300, costUsd: 0.02 };
    const merged = mergeTokenUsage(a, b);
    expect(merged.input).toBe(300);
    expect(merged.output).toBe(150);
    expect(merged.total).toBe(450);
    expect(merged.costUsd).toBeCloseTo(0.03);
  });
});

describe('emptyTokenUsage', () => {
  it('全部為 0', () => {
    const usage = emptyTokenUsage();
    expect(usage.input).toBe(0);
    expect(usage.output).toBe(0);
    expect(usage.total).toBe(0);
    expect(usage.costUsd).toBe(0);
  });
});

describe('formatTokenUsage', () => {
  it('格式化基本用量', () => {
    const usage = { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500, costUsd: 0 };
    const result = formatTokenUsage(usage);
    expect(result).toContain('1,000');
    expect(result).toContain('500');
    expect(result).toContain('1,500');
  });

  it('有快取時顯示快取資訊', () => {
    const usage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 30, total: 150, costUsd: 0 };
    const result = formatTokenUsage(usage);
    expect(result).toContain('快取讀取');
    expect(result).toContain('快取寫入');
  });

  it('無快取時不顯示快取', () => {
    const usage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 };
    const result = formatTokenUsage(usage);
    expect(result).not.toContain('快取');
  });
});
