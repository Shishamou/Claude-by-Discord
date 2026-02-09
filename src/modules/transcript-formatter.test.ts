import { describe, it, expect } from 'vitest';
import { formatTranscript } from './transcript-formatter.js';
import type { TranscriptEntry } from '../types.js';

describe('formatTranscript', () => {
  it('空陣列回傳預設文字', () => {
    expect(formatTranscript([])).toBe('（無紀錄）');
  });

  it('格式化使用者訊息', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T12:30:45Z'), type: 'user', content: '你好' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('12:30:45');
    expect(result).toContain('使用者');
    expect(result).toContain('你好');
  });

  it('格式化助手訊息', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'assistant', content: '回應內容' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('Claude');
    expect(result).toContain('回應內容');
  });

  it('格式化工具使用', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'tool_use', content: '{"file":"test.ts"}', toolName: 'Read' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('工具');
    expect(result).toContain('Read');
  });

  it('格式化結果', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'result', content: '完成' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('結果');
  });

  it('格式化錯誤', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'error', content: '出錯了' },
    ];
    const result = formatTranscript(entries);
    expect(result).toContain('錯誤');
  });

  it('多筆紀錄以雙換行分隔', () => {
    const entries: TranscriptEntry[] = [
      { timestamp: new Date('2025-01-01T10:00:00Z'), type: 'user', content: '問題' },
      { timestamp: new Date('2025-01-01T10:00:05Z'), type: 'assistant', content: '回答' },
    ];
    const result = formatTranscript(entries);
    expect(result.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });
});
