import { truncate, getRelativePath, formatNumber } from './formatters.js';
import type { ToolDisplayInfo } from '../types.js';

/**
 * 將工具名稱與輸入轉換為顯示用結構
 * @param toolName - 工具名稱
 * @param toolInput - 工具輸入參數
 * @param cwd - 工作目錄
 * @returns 格式化後的工具顯示資訊
 */
export function formatToolInput(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): ToolDisplayInfo {
  switch (toolName) {
    case 'Read':
      return formatRead(toolInput, cwd);
    case 'Write':
      return formatWrite(toolInput, cwd);
    case 'Edit':
      return formatEdit(toolInput, cwd);
    case 'Bash':
      return formatBash(toolInput);
    case 'Glob':
      return formatGlob(toolInput, cwd);
    case 'Grep':
      return formatGrep(toolInput, cwd);
    case 'WebFetch':
      return formatWebFetch(toolInput);
    case 'WebSearch':
      return formatWebSearch(toolInput);
    case 'Task':
      return formatTask(toolInput);
    case 'AskUser':
    case 'AskUserQuestion':
      return formatAskUserQuestion(toolInput);
    default:
      return formatDefault(toolName, toolInput);
  }
}

function formatRead(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const relativePath = getRelativePath(input.file_path as string, cwd);
  const result: ToolDisplayInfo = {
    title: '讀取檔案',
    description: `\`\`\`\n${relativePath}\n\`\`\``,
  };

  if (input.offset || input.limit) {
    result.fields = [
      {
        name: '範圍',
        value: `第 ${input.offset ?? 1} 行起，共 ${input.limit ?? '全部'} 行`,
        inline: true,
      },
    ];
  }

  return result;
}

function formatWrite(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const relativePath = getRelativePath(input.file_path as string, cwd);
  const content = input.content as string | undefined;
  const result: ToolDisplayInfo = {
    title: '寫入檔案',
    description: `\`\`\`\n${relativePath}\n\`\`\``,
  };

  if (content) {
    const lines = content.split('\n').length;
    const chars = content.length;
    result.fields = [
      {
        name: '內容大小',
        value: `${lines} 行 / ${formatNumber(chars)} 字元`,
        inline: true,
      },
    ];
  }

  return result;
}

function formatEdit(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const relativePath = getRelativePath(input.file_path as string, cwd);
  const oldString = input.old_string as string | undefined;
  const newString = input.new_string as string | undefined;
  const result: ToolDisplayInfo = {
    title: '編輯檔案',
    description: `\`\`\`\n${relativePath}\n\`\`\``,
  };

  if (oldString && newString) {
    result.fields = [
      {
        name: '🔴 移除',
        value: `\`\`\`diff\n- ${truncate(oldString.replace(/\n/g, '\n- '), 400)}\n\`\`\``,
        inline: false,
      },
      {
        name: '🟢 新增',
        value: `\`\`\`diff\n+ ${truncate(newString.replace(/\n/g, '\n+ '), 400)}\n\`\`\``,
        inline: false,
      },
    ];
  }

  return result;
}

function formatBash(input: Record<string, unknown>): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: '執行指令',
    description: `\`\`\`bash\n${truncate(input.command as string, 500)}\n\`\`\``,
  };

  if (input.description) {
    result.fields = [
      {
        name: '說明',
        value: truncate(input.description as string, 1024),
        inline: false,
      },
    ];
  }

  return result;
}

function formatGlob(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: '搜尋檔案',
    description: `Pattern: \`${input.pattern}\``,
  };

  if (input.path) {
    result.fields = [
      {
        name: '路徑',
        value: `\`${getRelativePath(input.path as string, cwd)}\``,
        inline: true,
      },
    ];
  }

  return result;
}

function formatGrep(input: Record<string, unknown>, cwd: string): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: '搜尋內容',
    description: `Pattern: \`${input.pattern}\``,
    fields: [],
  };

  if (input.path) {
    result.fields!.push({
      name: '路徑',
      value: `\`${getRelativePath(input.path as string, cwd)}\``,
      inline: true,
    });
  }

  if (input.glob) {
    result.fields!.push({
      name: '檔案過濾',
      value: `\`${input.glob}\``,
      inline: true,
    });
  }

  return result;
}

function formatWebFetch(input: Record<string, unknown>): ToolDisplayInfo {
  const result: ToolDisplayInfo = {
    title: '擷取網頁',
    description: input.url as string,
  };

  if (input.prompt) {
    result.fields = [
      {
        name: '提示',
        value: truncate(input.prompt as string, 200),
        inline: false,
      },
    ];
  }

  return result;
}

function formatWebSearch(input: Record<string, unknown>): ToolDisplayInfo {
  return {
    title: '搜尋網頁',
    description: `\`${input.query}\``,
  };
}

function formatTask(input: Record<string, unknown>): ToolDisplayInfo {
  return {
    title: '啟動子任務',
    description: (input.description as string) || '執行子任務',
    fields: [
      {
        name: '類型',
        value: `\`${(input.subagent_type as string) || '未知'}\``,
        inline: true,
      },
    ],
  };
}

function formatAskUserQuestion(input: Record<string, unknown>): ToolDisplayInfo {
  const questions = input.questions as Array<{
    question?: string;
    header?: string;
    options?: Array<{ label?: string; description?: string }>;
  }> | undefined;

  if (!questions || questions.length === 0) {
    return { title: '詢問使用者', description: '等待使用者回答' };
  }

  const description = questions
    .map((q) => {
      const header = q.header ? `**${q.header}**\n` : '';
      const question = q.question || '';
      const options = q.options
        ?.map((o) => `- ${o.label}${o.description ? `：${o.description}` : ''}`)
        .join('\n') || '';
      return `${header}${question}${options ? `\n${options}` : ''}`;
    })
    .join('\n\n');

  return {
    title: '詢問使用者',
    description: truncate(description, 4000),
  };
}

function formatDefault(toolName: string, input: Record<string, unknown>): ToolDisplayInfo {
  const keys = Object.keys(input).slice(0, 3);
  const description =
    keys.length > 0
      ? keys.map((k) => {
          const val = input[k];
          const display = typeof val === 'object' && val !== null
            ? truncate(JSON.stringify(val), 50)
            : truncate(String(val), 50);
          return `**${k}**: \`${display}\``;
        }).join('\n')
      : toolName;

  return {
    title: toolName,
    description,
  };
}
