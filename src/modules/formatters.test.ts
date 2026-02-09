import { describe, it, expect } from 'vitest';
import {
  truncate,
  getFileName,
  getRelativePath,
  formatNumber,
  chunkMessage,
  formatCodeBlock,
  formatDuration,
  formatCost,
} from './formatters.js';

describe('truncate', () => {
  it('短於上限時不截斷', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('超過上限時截斷並加省略號', () => {
    expect(truncate('hello world', 5)).toBe('hello…');
  });

  it('空字串回傳空字串', () => {
    expect(truncate('', 10)).toBe('');
  });

  it('剛好等於上限時不截斷', () => {
    expect(truncate('12345', 5)).toBe('12345');
  });
});

describe('getFileName', () => {
  it('回傳檔案名稱', () => {
    expect(getFileName('/Users/test/file.ts')).toBe('file.ts');
  });

  it('空字串回傳未知', () => {
    expect(getFileName('')).toBe('未知');
  });
});

describe('getRelativePath', () => {
  it('在 cwd 內回傳相對路徑', () => {
    expect(getRelativePath('/home/user/project/src/file.ts', '/home/user/project')).toBe('src/file.ts');
  });

  it('不在 cwd 內回傳完整路徑', () => {
    expect(getRelativePath('/other/file.ts', '/home/user/project')).toBe('/other/file.ts');
  });

  it('空字串回傳未知', () => {
    expect(getRelativePath('', '/home')).toBe('未知');
  });
});

describe('formatNumber', () => {
  it('格式化千分位', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('小數字不加分隔', () => {
    expect(formatNumber(42)).toBe('42');
  });
});

describe('chunkMessage', () => {
  it('短訊息不分割', () => {
    expect(chunkMessage('hello', 100)).toEqual(['hello']);
  });

  it('長訊息按行分割', () => {
    const text = 'line1\nline2\nline3';
    const chunks = chunkMessage(text, 11);
    expect(chunks.length).toBeGreaterThan(1);
    // 每個 chunk 不超過 maxLen
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(11);
    }
  });

  it('單行超長時截斷', () => {
    const text = 'a'.repeat(20);
    const chunks = chunkMessage(text, 10);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(10);
  });
});

describe('formatCodeBlock', () => {
  it('包裝為 code block', () => {
    const result = formatCodeBlock('const x = 1;', 'ts');
    expect(result).toBe('```ts\nconst x = 1;\n```');
  });

  it('無語言時用空字串', () => {
    const result = formatCodeBlock('hello');
    expect(result).toMatch(/^```\nhello\n```$/);
  });
});

describe('formatDuration', () => {
  it('毫秒', () => {
    expect(formatDuration(500)).toBe('500ms');
  });

  it('秒', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('分鐘 + 秒', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('整分鐘', () => {
    expect(formatDuration(120_000)).toBe('2m 0s');
  });
});

describe('chunkMessage 邊界', () => {
  it('空字串回傳包含空字串的陣列', () => {
    const chunks = chunkMessage('', 100);
    expect(chunks).toEqual(['']);
  });

  it('剛好等於上限時不分割', () => {
    const text = 'a'.repeat(100);
    expect(chunkMessage(text, 100)).toEqual([text]);
  });

  it('多行但每行都很短', () => {
    const text = 'a\nb\nc\nd\ne';
    const chunks = chunkMessage(text, 3);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(3);
    }
  });

  it('只有換行的字串', () => {
    const chunks = chunkMessage('\n\n\n', 100);
    expect(chunks).toEqual(['\n\n\n']);
  });
});

describe('truncate 邊界', () => {
  it('maxLen = 0 時截斷為空+省略號', () => {
    expect(truncate('hello', 0)).toBe('…');
  });

  it('maxLen = 1 時保留一字元+省略號', () => {
    expect(truncate('hello', 1)).toBe('h…');
  });
});

describe('formatDuration 邊界', () => {
  it('0ms', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('剛好 1000ms 顯示為秒', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('剛好 60000ms 顯示為分', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });
});

describe('formatCost', () => {
  it('格式化 USD 金額', () => {
    expect(formatCost(0.1234)).toBe('$0.1234');
  });

  it('補零到四位', () => {
    expect(formatCost(1)).toBe('$1.0000');
  });
});
