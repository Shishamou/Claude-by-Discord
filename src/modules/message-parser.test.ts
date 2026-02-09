import { describe, it, expect } from 'vitest';
import { extractAssistantText, extractToolUse, extractResult } from './message-parser.js';

// 模擬 SDK 訊息型別（避免依賴 SDK 內部結構）

describe('extractAssistantText', () => {
  it('擷取文字區塊', () => {
    const message = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      },
    };
    expect(extractAssistantText(message as any)).toBe('Hello\nWorld');
  });

  it('忽略非文字區塊', () => {
    const message = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', name: 'Read', input: {}, id: 'id1' },
        ],
      },
    };
    expect(extractAssistantText(message as any)).toBe('Hello');
  });

  it('content 為 undefined 時回傳空字串', () => {
    const message = { type: 'assistant' as const, message: {} };
    expect(extractAssistantText(message as any)).toBe('');
  });

  it('message 為 undefined 時回傳空字串', () => {
    const message = { type: 'assistant' as const };
    expect(extractAssistantText(message as any)).toBe('');
  });

  it('content 非陣列時回傳空字串', () => {
    const message = { type: 'assistant' as const, message: { content: 'string' } };
    expect(extractAssistantText(message as any)).toBe('');
  });

  it('空 content 陣列回傳空字串', () => {
    const message = { type: 'assistant' as const, message: { content: [] } };
    expect(extractAssistantText(message as any)).toBe('');
  });
});

describe('extractToolUse', () => {
  it('擷取工具呼叫', () => {
    const message = {
      type: 'assistant' as const,
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/test.ts' }, id: 'tool-1' },
          { type: 'tool_use', name: 'Bash', input: { command: 'ls' }, id: 'tool-2' },
        ],
      },
    };
    const tools = extractToolUse(message as any);
    expect(tools).toHaveLength(2);
    expect(tools[0].toolName).toBe('Read');
    expect(tools[0].toolInput).toEqual({ file_path: '/test.ts' });
    expect(tools[0].toolUseId).toBe('tool-1');
    expect(tools[1].toolName).toBe('Bash');
  });

  it('無工具呼叫時回傳空陣列', () => {
    const message = {
      type: 'assistant' as const,
      message: { content: [{ type: 'text', text: 'just text' }] },
    };
    expect(extractToolUse(message as any)).toEqual([]);
  });

  it('content 為 undefined 時回傳空陣列', () => {
    const message = { type: 'assistant' as const, message: {} };
    expect(extractToolUse(message as any)).toEqual([]);
  });
});

describe('extractResult', () => {
  it('擷取成功結果', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success',
      result: '任務完成',
      duration_ms: 5000,
      total_cost_usd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 10,
      },
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(true);
    expect(result.text).toBe('任務完成');
    expect(result.durationMs).toBe(5000);
    expect(result.costUsd).toBe(0.05);
    expect(result.usage.input_tokens).toBe(100);
  });

  it('擷取失敗結果', () => {
    const message = {
      type: 'result' as const,
      subtype: 'error',
      errors: ['error1', 'error2'],
      duration_ms: 1000,
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(false);
    expect(result.text).toBe('error1\nerror2');
  });

  it('失敗但無 errors 時用預設訊息', () => {
    const message = {
      type: 'result' as const,
      subtype: 'error',
      duration_ms: 0,
      total_cost_usd: 0,
      usage: {},
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(false);
    expect(result.text).toContain('錯誤');
  });

  it('成功但無 result 時回傳空字串', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success',
      duration_ms: 0,
      total_cost_usd: 0,
      usage: {},
    };
    const result = extractResult(message as any);
    expect(result.success).toBe(true);
    expect(result.text).toBe('');
  });

  it('usage 欄位缺少時預設為 0', () => {
    const message = {
      type: 'result' as const,
      subtype: 'success',
      result: 'ok',
      duration_ms: 0,
      total_cost_usd: 0,
      usage: {},
    };
    const result = extractResult(message as any);
    expect(result.usage.input_tokens).toBe(0);
    expect(result.usage.output_tokens).toBe(0);
    expect(result.usage.cache_read_input_tokens).toBe(0);
    expect(result.usage.cache_creation_input_tokens).toBe(0);
  });
});
