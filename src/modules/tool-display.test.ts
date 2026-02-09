import { describe, it, expect } from 'vitest';
import { formatToolInput } from './tool-display.js';

const CWD = '/home/user/project';

describe('formatToolInput', () => {
  describe('Read', () => {
    it('顯示相對路徑', () => {
      const result = formatToolInput('Read', { file_path: `${CWD}/src/index.ts` }, CWD);
      expect(result.title).toBe('讀取檔案');
      expect(result.description).toContain('src/index.ts');
    });

    it('有 offset/limit 時顯示範圍', () => {
      const result = formatToolInput('Read', { file_path: `${CWD}/file.ts`, offset: 10, limit: 20 }, CWD);
      expect(result.fields).toBeDefined();
      expect(result.fields![0].value).toContain('10');
      expect(result.fields![0].value).toContain('20');
    });

    it('無 offset/limit 時沒有 fields', () => {
      const result = formatToolInput('Read', { file_path: `${CWD}/file.ts` }, CWD);
      expect(result.fields).toBeUndefined();
    });

    it('file_path 為 undefined 時不崩潰', () => {
      const result = formatToolInput('Read', {}, CWD);
      expect(result.title).toBe('讀取檔案');
      expect(result.description).toContain('未知');
    });
  });

  describe('Write', () => {
    it('顯示檔案路徑與內容大小', () => {
      const result = formatToolInput('Write', {
        file_path: `${CWD}/out.ts`,
        content: 'line1\nline2\nline3',
      }, CWD);
      expect(result.title).toBe('寫入檔案');
      expect(result.fields![0].value).toContain('3 行');
    });

    it('無 content 時沒有 fields', () => {
      const result = formatToolInput('Write', { file_path: `${CWD}/out.ts` }, CWD);
      expect(result.fields).toBeUndefined();
    });
  });

  describe('Edit', () => {
    it('顯示 diff', () => {
      const result = formatToolInput('Edit', {
        file_path: `${CWD}/file.ts`,
        old_string: 'old',
        new_string: 'new',
      }, CWD);
      expect(result.title).toBe('編輯檔案');
      expect(result.fields).toHaveLength(2);
      expect(result.fields![0].name).toContain('移除');
      expect(result.fields![1].name).toContain('新增');
    });

    it('缺少 old_string 或 new_string 時沒有 diff fields', () => {
      const result = formatToolInput('Edit', { file_path: `${CWD}/file.ts`, old_string: 'old' }, CWD);
      expect(result.fields).toBeUndefined();
    });
  });

  describe('Bash', () => {
    it('顯示指令', () => {
      const result = formatToolInput('Bash', { command: 'ls -la' }, CWD);
      expect(result.title).toBe('執行指令');
      expect(result.description).toContain('ls -la');
    });

    it('有 description 時顯示說明', () => {
      const result = formatToolInput('Bash', { command: 'npm test', description: '跑測試' }, CWD);
      expect(result.fields![0].value).toBe('跑測試');
    });

    it('超長指令被截斷', () => {
      const longCmd = 'a'.repeat(1000);
      const result = formatToolInput('Bash', { command: longCmd }, CWD);
      expect(result.description!.length).toBeLessThan(600);
    });
  });

  describe('Glob', () => {
    it('顯示 pattern', () => {
      const result = formatToolInput('Glob', { pattern: '**/*.ts' }, CWD);
      expect(result.title).toBe('搜尋檔案');
      expect(result.description).toContain('**/*.ts');
    });

    it('有 path 時顯示路徑', () => {
      const result = formatToolInput('Glob', { pattern: '*.ts', path: `${CWD}/src` }, CWD);
      expect(result.fields).toBeDefined();
    });
  });

  describe('Grep', () => {
    it('顯示 pattern', () => {
      const result = formatToolInput('Grep', { pattern: 'TODO' }, CWD);
      expect(result.title).toBe('搜尋內容');
      expect(result.description).toContain('TODO');
    });

    it('有 path 和 glob 時顯示欄位', () => {
      const result = formatToolInput('Grep', {
        pattern: 'error',
        path: `${CWD}/src`,
        glob: '*.ts',
      }, CWD);
      expect(result.fields).toHaveLength(2);
    });
  });

  describe('WebFetch', () => {
    it('顯示 URL', () => {
      const result = formatToolInput('WebFetch', { url: 'https://example.com' }, CWD);
      expect(result.title).toBe('擷取網頁');
      expect(result.description).toContain('example.com');
    });
  });

  describe('WebSearch', () => {
    it('顯示查詢', () => {
      const result = formatToolInput('WebSearch', { query: 'TypeScript tips' }, CWD);
      expect(result.title).toBe('搜尋網頁');
      expect(result.description).toContain('TypeScript tips');
    });
  });

  describe('Task', () => {
    it('顯示子任務描述', () => {
      const result = formatToolInput('Task', { description: '搜尋檔案', subagent_type: 'Explore' }, CWD);
      expect(result.title).toBe('啟動子任務');
      expect(result.description).toBe('搜尋檔案');
      expect(result.fields![0].value).toContain('Explore');
    });

    it('缺少描述時用預設', () => {
      const result = formatToolInput('Task', {}, CWD);
      expect(result.description).toBe('執行子任務');
    });
  });

  describe('AskUserQuestion', () => {
    it('顯示問題與選項', () => {
      const result = formatToolInput('AskUserQuestion', {
        questions: [{
          header: '選擇',
          question: '要用哪個？',
          options: [
            { label: 'A', description: '選項 A' },
            { label: 'B' },
          ],
        }],
      }, CWD);
      expect(result.title).toBe('詢問使用者');
      expect(result.description).toContain('選擇');
      expect(result.description).toContain('要用哪個？');
      expect(result.description).toContain('A');
    });

    it('空 questions 回傳預設', () => {
      const result = formatToolInput('AskUserQuestion', { questions: [] }, CWD);
      expect(result.description).toContain('等待');
    });

    it('無 questions 欄位回傳預設', () => {
      const result = formatToolInput('AskUserQuestion', {}, CWD);
      expect(result.description).toContain('等待');
    });
  });

  describe('未知工具', () => {
    it('顯示工具名稱與前幾個 key', () => {
      const result = formatToolInput('UnknownTool', { key1: 'val1', key2: 42 }, CWD);
      expect(result.title).toBe('UnknownTool');
      expect(result.description).toContain('key1');
      expect(result.description).toContain('val1');
    });

    it('空 input 顯示工具名稱', () => {
      const result = formatToolInput('EmptyTool', {}, CWD);
      expect(result.description).toBe('EmptyTool');
    });

    it('物件值 JSON 序列化', () => {
      const result = formatToolInput('X', { data: { nested: true } }, CWD);
      expect(result.description).toContain('nested');
    });
  });
});
