import type { TokenUsage } from '../types.js';
import { formatNumber } from './formatters.js';

/**
 * 計算 Token 使用量
 * @param usage - SDK 回傳的原始 Token 使用量
 * @returns 結構化的 Token 使用量
 */
export function calculateTokenUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): TokenUsage {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const total = input + output;

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total,
    costUsd: 0,
  };
}

/**
 * 合併多筆 Token 使用量
 * @param a - 第一筆 Token 使用量
 * @param b - 第二筆 Token 使用量
 * @returns 合併後的 Token 使用量
 */
export function mergeTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    total: a.total + b.total,
    costUsd: a.costUsd + b.costUsd,
  };
}

/**
 * 建立空的 Token 使用量
 * @returns 所有欄位為零的 Token 使用量
 */
export function emptyTokenUsage(): TokenUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    costUsd: 0,
  };
}

/**
 * 格式化 Token 使用量為可讀字串
 * @param usage - Token 使用量
 * @returns 多行的可讀字串
 */
export function formatTokenUsage(usage: TokenUsage): string {
  const lines = [
    `輸入: ${formatNumber(usage.input)}`,
    `輸出: ${formatNumber(usage.output)}`,
    `總計: ${formatNumber(usage.total)}`,
  ];

  if (usage.cacheRead > 0) {
    lines.push(`快取讀取: ${formatNumber(usage.cacheRead)}`);
  }
  if (usage.cacheWrite > 0) {
    lines.push(`快取寫入: ${formatNumber(usage.cacheWrite)}`);
  }

  return lines.join('\n');
}
