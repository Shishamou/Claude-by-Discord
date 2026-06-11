import path from 'node:path';

/**
 * 截斷文字，超過長度加上省略號
 * @param str - 原始字串
 * @param maxLen - 最大長度
 * @returns 截斷後的字串
 */
export function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/**
 * 取得檔案名稱
 * @param filePath - 檔案完整路徑
 * @returns 檔案名稱（不含路徑）
 */
export function getFileName(filePath: string): string {
  return filePath ? path.basename(filePath) : '未知';
}

/**
 * 取得相對路徑
 * @param filePath - 檔案完整路徑
 * @param cwd - 工作目錄
 * @returns 相對於工作目錄的路徑
 */
export function getRelativePath(filePath: string, cwd: string): string {
  if (!filePath) return '未知';
  if (cwd && filePath.startsWith(cwd)) {
    return filePath.slice(cwd.length + 1) || getFileName(filePath);
  }
  return filePath;
}

/**
 * 格式化數字（千分位）
 * @param num - 要格式化的數字
 * @returns 帶千分位的數字字串
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * 將長文字切分為多個區塊，不超過指定長度
 * @param text - 原始文字
 * @param maxLen - 每個區塊的最大長度
 * @returns 切分後的文字區塊陣列
 */
export function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLen) {
      if (current) chunks.push(current);
      current = line.length > maxLen ? line.slice(0, maxLen) : line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * 包裝為 code block
 * @param code - 程式碼內容
 * @param language - 程式語言標記
 * @param maxLen - 最大長度（含 code block 語法）
 * @returns Markdown code block 字串
 */
export function formatCodeBlock(code: string, language = '', maxLen = 1900): string {
  const prefix = `\`\`\`${language}\n`;
  const suffix = '\n```';
  const available = maxLen - prefix.length - suffix.length;
  const truncated = truncate(code, available);
  return `${prefix}${truncated}${suffix}`;
}

/**
 * 格式化 diff 顯示
 * @param oldStr - 舊內容
 * @param newStr - 新內容
 * @param maxLen - 每段內容的最大長度
 * @returns Markdown diff 格式字串
 */
export function formatDiff(oldStr: string, newStr: string, maxLen = 400): string {
  const oldLines = '- ' + truncate(oldStr.replace(/\n/g, '\n- '), maxLen);
  const newLines = '+ ' + truncate(newStr.replace(/\n/g, '\n+ '), maxLen);
  return `\`\`\`diff\n${oldLines}\n\`\`\`\n\`\`\`diff\n${newLines}\n\`\`\``;
}

/**
 * 格式化持續時間（毫秒轉為人類可讀格式）
 * @param ms - 毫秒數
 * @returns 人類可讀的持續時間字串
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * 格式化費用
 * @param usd - 美元金額
 * @returns 格式化後的費用字串
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * 將 Markdown 表格轉換為 code block 格式
 * Discord 不支援 Markdown 表格語法，改用等寬字型 code block 保持對齊
 * @param text - 含有 Markdown 表格的文字
 * @returns 表格已轉為 code block 的文字
 */
export function convertMarkdownTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  const isTableRow = (line: string) => {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 1;
  };

  const isSeparatorRow = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return false;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
    return cells.every((c) => /^\s*:?-+:?\s*$/.test(c));
  };

  const flushTable = () => {
    if (tableLines.length < 2) {
      // 不是有效表格，原樣輸出
      result.push(...tableLines);
      tableLines = [];
      return;
    }

    // 解析每一列的欄位
    const parsed = tableLines
      .filter((l) => !isSeparatorRow(l))
      .map((l) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()),
      );

    if (parsed.length === 0) {
      result.push(...tableLines);
      tableLines = [];
      return;
    }

    // 計算每欄最大寬度（考慮全形字元）
    const colCount = Math.max(...parsed.map((r) => r.length));
    const colWidths: number[] = Array.from({ length: colCount }, () => 0);
    for (const row of parsed) {
      for (let i = 0; i < colCount; i++) {
        const cell = row[i] || '';
        colWidths[i] = Math.max(colWidths[i], displayWidth(cell));
      }
    }

    // 建構對齊後的文字行
    const formatted: string[] = [];
    for (let ri = 0; ri < parsed.length; ri++) {
      const row = parsed[ri];
      const cells = Array.from({ length: colCount }, (_, i) => {
        const cell = row[i] || '';
        return cell + ' '.repeat(colWidths[i] - displayWidth(cell));
      });
      formatted.push(cells.join('  '));
      // 在表頭後插入分隔線
      if (ri === 0) {
        formatted.push(colWidths.map((w) => '─'.repeat(w)).join('──'));
      }
    }

    result.push('```');
    result.push(...formatted);
    result.push('```');
    tableLines = [];
  };

  // 追蹤 ``` fence 狀態，code block 內的內容不做表格轉換
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inTable) {
        flushTable();
        inTable = false;
      }
      inFence = !inFence;
      result.push(line);
      continue;
    }
    if (!inFence && isTableRow(line)) {
      if (!inTable) inTable = true;
      tableLines.push(line);
    } else {
      if (inTable) {
        flushTable();
        inTable = false;
      }
      result.push(line);
    }
  }

  // 處理結尾處的表格
  if (inTable) flushTable();

  return result.join('\n');
}

/**
 * 計算字串的顯示寬度（全形字元算 2 格）
 */
function displayWidth(str: string): number {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // CJK 統一漢字、全形字元等算 2 格
    if (
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x2fffd) ||
      (code >= 0x30000 && code <= 0x3fffd)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 將文字格式化為適合 Discord 顯示的格式
 * - 將 Markdown 表格轉為 code block
 * @param text - 原始文字
 * @returns Discord 友善的格式化文字
 */
export function formatForDiscord(text: string): string {
  return convertMarkdownTables(text);
}
