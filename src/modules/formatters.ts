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
