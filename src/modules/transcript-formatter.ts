import type { TranscriptEntry } from '../types.js';

/**
 * 格式化 Transcript 為 Markdown 文字
 * @param entries - Transcript 條目陣列
 * @returns 格式化後的 Markdown 字串
 */
export function formatTranscript(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return '（無紀錄）';

  return entries
    .map((entry) => {
      const time = entry.timestamp.toISOString().slice(11, 19);
      switch (entry.type) {
        case 'user':
          return `**[${time}] 使用者：**\n${entry.content}`;
        case 'assistant':
          return `**[${time}] Claude：**\n${entry.content}`;
        case 'tool_use':
          return `**[${time}] 工具 (${entry.toolName})：**\n${entry.content}`;
        case 'result':
          return `**[${time}] 結果：**\n${entry.content}`;
        case 'error':
          return `**[${time}] 錯誤：**\n${entry.content}`;
        default:
          return `**[${time}]** ${entry.content}`;
      }
    })
    .join('\n\n');
}
