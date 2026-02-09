import type { APIEmbed } from 'discord.js';
import type {
  AskState,
  SessionState,
  TokenUsage,
} from '../types.js';
import type { GlobalUsageStats, SessionUsageRecord } from '../effects/usage-store.js';
import {
  COLORS,
  TOOL_EMOJI,
  PERMISSION_MODE_NAMES,
  SESSION_STATUS_NAMES,
} from '../types.js';
import { formatToolInput } from './tool-display.js';
import { formatNumber, formatDuration, formatCost, truncate } from './formatters.js';

// ─── 工具使用 Embed ─────────────────────────────────

/**
 * 建構工具使用通知 Embed
 * @param toolName - 工具名稱
 * @param toolInput - 工具輸入參數
 * @param cwd - 工作目錄
 * @param meta - 選填的元資訊（模型、權限模式、Session ID）
 * @returns 工具使用通知 Embed
 */
export function buildToolUseEmbed(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
  meta?: { model?: string; permissionMode?: string; sessionId?: string },
): APIEmbed {
  const emoji = TOOL_EMOJI[toolName] || '🔧';
  const display = formatToolInput(toolName, toolInput, cwd);

  return {
    color: COLORS.PreToolUse,
    author: { name: `${emoji} ${toolName}` },
    title: display.title,
    description: display.description,
    fields: display.fields,
    timestamp: new Date().toISOString(),
    footer: meta
      ? {
          text: buildFooterText(meta.model, meta.permissionMode, meta.sessionId),
        }
      : undefined,
  };
}

// ─── 權限請求 Embed ─────────────────────────────────

/**
 * 建構權限請求 Embed（附帶 Approve/Deny 按鈕）
 * @param toolName - 工具名稱
 * @param toolInput - 工具輸入參數
 * @param cwd - 工作目錄
 * @returns 權限請求 Embed
 */
export function buildPermissionRequestEmbed(
  toolName: string,
  toolInput: Record<string, unknown>,
  cwd: string,
): APIEmbed {
  const emoji = TOOL_EMOJI[toolName] || '🔧';
  const display = formatToolInput(toolName, toolInput, cwd);

  return {
    color: COLORS.Permission,
    author: { name: '🔐 需要審批' },
    title: `${emoji} ${toolName} — ${display.title}`,
    description: display.description,
    fields: [
      ...(display.fields || []),
      {
        name: '操作',
        value: '點擊下方按鈕核准或拒絕',
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── 進度 Embed ─────────────────────────────────────

/**
 * 建構串流進度 Embed
 * @param text - 目前的進度文字
 * @param toolsUsed - 已使用的工具次數
 * @returns 進度 Embed
 */
export function buildProgressEmbed(
  text: string,
  toolsUsed: number,
): APIEmbed {
  return {
    color: COLORS.Running,
    author: { name: '⏳ 執行中' },
    description: truncate(text, 4000),
    footer: { text: `🔧 已使用 ${toolsUsed} 個工具` },
    timestamp: new Date().toISOString(),
  };
}

// ─── 串流文字 Embed ─────────────────────────────────

/**
 * 建構串流中的即時文字 Embed
 * @param text - 串流中的即時文字內容
 * @param toolsUsed - 已使用的工具次數
 * @returns 串流文字 Embed
 */
export function buildStreamingTextEmbed(
  text: string,
  toolsUsed: number,
): APIEmbed {
  return {
    color: COLORS.Running,
    author: { name: '💬 回應中...' },
    description: truncate(text, 4000),
    footer: { text: `🔧 已使用 ${toolsUsed} 個工具` },
    timestamp: new Date().toISOString(),
  };
}

// ─── 中斷預覽 Embed ─────────────────────────────────

/**
 * 建構中斷預覽 Embed（確認前顯示進度摘要）
 * @param session - 目前的 Session 狀態
 * @param durationMs - 已執行的時間（毫秒）
 * @returns 中斷預覽 Embed
 */
export function buildStopPreviewEmbed(
  session: SessionState,
  durationMs: number,
): APIEmbed {
  const toolList = Object.entries(session.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  const statusName = SESSION_STATUS_NAMES[session.status];

  return {
    color: COLORS.Notification,
    author: { name: '⚠️ 確認中斷' },
    title: '確定要中斷此任務？',
    description: truncate(session.promptText, 200),
    fields: [
      { name: '目前狀態', value: statusName, inline: true },
      { name: '執行時間', value: formatDuration(durationMs), inline: true },
      {
        name: `工具統計（共 ${session.toolCount} 次）`,
        value: toolList || '尚無',
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── 結果 Embed ─────────────────────────────────────

/**
 * 建構任務完成結果 Embed
 * @param resultText - 任務完成的結果文字
 * @param stats - 工具使用統計（次數與各工具計數）
 * @param usage - 選填的 Token 使用量
 * @param durationMs - 選填的執行時間（毫秒）
 * @param costUsd - 選填的費用（美元）
 * @returns 任務完成結果 Embed
 */
export function buildResultEmbed(
  resultText: string,
  stats: { toolCount: number; tools: Record<string, number> },
  usage?: TokenUsage,
  durationMs?: number,
  costUsd?: number,
): APIEmbed {
  const toolList = Object.entries(stats.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  const fields: APIEmbed['fields'] = [
    {
      name: `📊 工具統計（共 ${stats.toolCount} 次）`,
      value: toolList || '無',
      inline: true,
    },
  ];

  if (usage) {
    fields.push({
      name: '🪙 Token 消耗',
      value: [
        `輸入: **${formatNumber(usage.input)}**`,
        `輸出: **${formatNumber(usage.output)}**`,
        `總計: **${formatNumber(usage.total)}**`,
      ].join('\n'),
      inline: true,
    });

    if (usage.cacheRead > 0 || usage.cacheWrite > 0) {
      fields.push({
        name: '♻️ 快取',
        value: [
          usage.cacheRead > 0 ? `讀取: ${formatNumber(usage.cacheRead)}` : null,
          usage.cacheWrite > 0 ? `寫入: ${formatNumber(usage.cacheWrite)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      });
    }
  }

  if (durationMs !== undefined) {
    fields.push({
      name: '⏱️ 耗時',
      value: formatDuration(durationMs),
      inline: true,
    });
  }

  if (costUsd !== undefined) {
    fields.push({
      name: '💰 費用',
      value: formatCost(costUsd),
      inline: true,
    });
  }

  return {
    color: COLORS.Stop,
    author: { name: '🏁 任務完成' },
    title: 'Claude Code 已完成任務',
    description: resultText ? truncate(resultText, 4000) : undefined,
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ─── 錯誤 Embed ─────────────────────────────────────

/**
 * 建構錯誤 Embed
 * @param error - 錯誤訊息
 * @param context - 選填的錯誤上下文描述
 * @returns 錯誤 Embed
 */
export function buildErrorEmbed(error: string, context?: string): APIEmbed {
  return {
    color: COLORS.Error,
    author: { name: '❌ 錯誤' },
    title: '執行發生錯誤',
    description: truncate(error, 4000),
    fields: context
      ? [{ name: '上下文', value: truncate(context, 1024), inline: false }]
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

// ─── 狀態 Embed ─────────────────────────────────────

/**
 * 建構 Session 狀態 Embed
 * @param session - Session 狀態，若為 null 則顯示無活躍 Session
 * @param sessionUsage - 選填的 Session Token 使用紀錄
 * @returns Session 狀態 Embed
 */
export function buildStatusEmbed(
  session: SessionState | null,
  sessionUsage?: SessionUsageRecord,
): APIEmbed {
  if (!session) {
    return {
      color: COLORS.Info,
      author: { name: 'ℹ️ 狀態' },
      title: '無活躍 Session',
      description: '目前沒有正在執行的任務。使用 `/prompt` 開始新任務。',
      timestamp: new Date().toISOString(),
    };
  }

  const elapsed = Date.now() - session.startedAt.getTime();
  const statusName = SESSION_STATUS_NAMES[session.status];

  const toolList = Object.entries(session.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  const fields: APIEmbed['fields'] = [
    { name: '工作目錄', value: `\`${session.cwd}\``, inline: true },
    { name: '模型', value: session.model, inline: true },
    { name: '執行時間', value: formatDuration(elapsed), inline: true },
    {
      name: `工具統計（共 ${session.toolCount} 次）`,
      value: toolList || '尚無',
      inline: false,
    },
  ];

  if (sessionUsage && sessionUsage.usage.total > 0) {
    fields.push({
      name: '🪙 累計 Token',
      value: [
        `輸入: **${formatNumber(sessionUsage.usage.input)}**`,
        `輸出: **${formatNumber(sessionUsage.usage.output)}**`,
        `總計: **${formatNumber(sessionUsage.usage.total)}**`,
      ].join('\n'),
      inline: true,
    });
    if (sessionUsage.costUsd > 0) {
      fields.push({
        name: '💰 費用',
        value: formatCost(sessionUsage.costUsd),
        inline: true,
      });
    }
  }

  return {
    color: session.status === 'running' ? COLORS.Running : COLORS.Info,
    author: { name: `📋 Session 狀態 — ${statusName}` },
    title: truncate(session.promptText, 100),
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ─── Session 開始 Embed ─────────────────────────────

/**
 * 建構 Session 開始 Embed
 * @param promptText - 使用者的 Prompt 文字
 * @param cwd - 工作目錄
 * @param model - 使用的模型名稱
 * @returns Session 開始 Embed
 */
export function buildSessionStartEmbed(
  promptText: string,
  cwd: string,
  model: string,
): APIEmbed {
  return {
    color: COLORS.SessionStart,
    author: { name: '🚀 Session 開始' },
    title: truncate(promptText, 100),
    fields: [
      { name: '工作目錄', value: `\`${cwd}\``, inline: true },
      { name: '模型', value: model, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── 中斷確認 Embed ─────────────────────────────────

/**
 * 建構中斷確認 Embed
 * @param stats - 工具使用統計（次數與各工具計數）
 * @param durationMs - 執行時間（毫秒）
 * @returns 中斷確認 Embed
 */
export function buildStopConfirmEmbed(
  stats: { toolCount: number; tools: Record<string, number> },
  durationMs: number,
): APIEmbed {
  const toolList = Object.entries(stats.tools)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${TOOL_EMOJI[name] || '🔧'} ${name}: **${count}**`)
    .join('\n');

  return {
    color: COLORS.Error,
    author: { name: '🛑 已中斷' },
    title: '任務已被手動中斷',
    fields: [
      { name: '執行時間', value: formatDuration(durationMs), inline: true },
      {
        name: `工具統計（共 ${stats.toolCount} 次）`,
        value: toolList || '無',
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// ─── 通知 Embed ─────────────────────────────────────

/**
 * 建構通知 Embed
 * @param message - 通知訊息內容
 * @returns 通知 Embed
 */
export function buildNotificationEmbed(message: string): APIEmbed {
  return {
    color: COLORS.Notification,
    author: { name: '🔔 通知' },
    description: message,
    timestamp: new Date().toISOString(),
  };
}

// ─── 續問 Embed ─────────────────────────────────────

/**
 * 建構續問確認 Embed
 * @param promptText - 續問的 Prompt 文字
 * @param fileCount - 附加檔案數量
 * @param filenames - 附加檔案名稱列表
 * @returns 續問確認 Embed
 */
export function buildFollowUpEmbed(promptText: string, fileCount = 0, filenames: string[] = []): APIEmbed {
  let description = truncate(promptText, 3900);

  if (fileCount > 0) {
    const fileList = filenames.length > 0
      ? filenames.map((f) => `\`${f}\``).join(', ')
      : `${fileCount} 個檔案`;
    description += `\n\n📎 ${fileList}`;
  }

  return {
    color: COLORS.SessionStart,
    author: { name: '💬 續問' },
    title: '正在處理續問...',
    description: truncate(description, 4000),
    timestamp: new Date().toISOString(),
  };
}

// ─── 等待輸入 Embed ─────────────────────────────────

/**
 * 建構等待輸入 Embed
 * @returns 等待輸入 Embed
 */
export function buildWaitingInputEmbed(): APIEmbed {
  return {
    color: COLORS.WaitingInput,
    author: { name: '⏸️ 等待輸入' },
    title: '任務已完成，等待續問',
    description: '在此 Thread 中輸入訊息即可繼續對話。使用 `/stop` 結束 Session。',
    timestamp: new Date().toISOString(),
  };
}

// ─── 多 Session 狀態摘要 Embed ─────────────────────

/**
 * 建構多 Session 狀態摘要 Embed
 * @param sessions - 所有活躍 Session 的 Map（key 為 threadId）
 * @returns 多 Session 狀態摘要 Embed
 */
export function buildMultiStatusEmbed(
  sessions: Map<string, SessionState>,
): APIEmbed {
  const entries = Array.from(sessions.entries());
  const description = entries
    .map(([threadId, s]) => {
      const statusName = SESSION_STATUS_NAMES[s.status];
      const elapsed = Date.now() - s.startedAt.getTime();
      return `**<#${threadId}>** — ${statusName}\n${truncate(s.promptText, 60)} • ${formatDuration(elapsed)} • 🔧 ${s.toolCount}`;
    })
    .join('\n\n');

  return {
    color: COLORS.Running,
    author: { name: `📋 活躍 Sessions（${entries.length}）` },
    description: truncate(description, 4000),
    timestamp: new Date().toISOString(),
  };
}

// ─── 全域狀態 Embed ─────────────────────────────────

/**
 * 建構全域 Bot 狀態 Embed（Thread 外使用 /status 時顯示）
 * @param stats - 全域使用量統計
 * @param activeSessions - 所有活躍 Session 的 Map（key 為 threadId）
 * @returns 全域 Bot 狀態 Embed
 */
export function buildGlobalStatusEmbed(
  stats: GlobalUsageStats,
  activeSessions: Map<string, SessionState>,
): APIEmbed {
  const uptime = Date.now() - stats.bootedAt.getTime();

  const fields: APIEmbed['fields'] = [
    { name: '⏱️ 運行時間', value: formatDuration(uptime), inline: true },
    { name: '📊 Session 總數', value: `${stats.totalSessions}`, inline: true },
    { name: '🔄 活躍 Sessions', value: `${activeSessions.size}`, inline: true },
  ];

  if (stats.totalUsage.total > 0) {
    fields.push({
      name: '🪙 累計 Token',
      value: [
        `輸入: **${formatNumber(stats.totalUsage.input)}**`,
        `輸出: **${formatNumber(stats.totalUsage.output)}**`,
        `總計: **${formatNumber(stats.totalUsage.total)}**`,
      ].join('\n'),
      inline: true,
    });
  }

  if (stats.totalCostUsd > 0) {
    fields.push({
      name: '💰 累計費用',
      value: formatCost(stats.totalCostUsd),
      inline: true,
    });
  }

  if (activeSessions.size > 0) {
    const sessionSummary = Array.from(activeSessions.entries())
      .map(([threadId, s]) => {
        const statusName = SESSION_STATUS_NAMES[s.status];
        return `<#${threadId}> — ${statusName}`;
      })
      .join('\n');
    fields.push({
      name: `活躍 Sessions（${activeSessions.size}）`,
      value: truncate(sessionSummary, 1024),
      inline: false,
    });
  }

  return {
    color: COLORS.Info,
    author: { name: '📋 Bot 狀態' },
    title: 'Discord Claude Bot',
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ─── 重試 Embed ─────────────────────────────────────

/**
 * 建構重試確認 Embed
 * @param promptText - 重試的 Prompt 文字
 * @returns 重試確認 Embed
 */
export function buildRetryEmbed(promptText: string): APIEmbed {
  return {
    color: COLORS.SessionStart,
    author: { name: '🔄 重試' },
    title: '重新執行任務',
    description: truncate(promptText, 4000),
    timestamp: new Date().toISOString(),
  };
}

// ─── AskUserQuestion Embed ──────────────────────────

/**
 * 建構 AskUserQuestion 專用 Embed（顯示問題與選項）
 * @param toolInput - 工具輸入參數（包含 questions 陣列）
 * @param _cwd - 工作目錄（保留參數，未使用）
 * @returns AskUserQuestion Embed
 */
export function buildAskUserQuestionEmbed(
  toolInput: Record<string, unknown>,
  _cwd: string,
): APIEmbed {
  const questions = toolInput.questions as Array<{
    question?: string;
    header?: string;
    options?: Array<{ label?: string; description?: string }>;
  }> | undefined;

  if (!questions || questions.length === 0) {
    return {
      color: COLORS.Permission,
      author: { name: '❓ Claude 提問' },
      title: '等待使用者回答',
      timestamp: new Date().toISOString(),
    };
  }

  const description = questions
    .map((q, i) => {
      const header = q.header ? `**${q.header}**` : '';
      const question = q.question || '';
      const options = q.options
        ?.map((o, j) => `> ${j + 1}. **${o.label}**${o.description ? ` — ${o.description}` : ''}`)
        .join('\n') || '';
      return `${header}${header && question ? '\n' : ''}${question}${options ? `\n${options}` : ''}`;
    })
    .join('\n\n');

  return {
    color: COLORS.Permission,
    author: { name: '❓ Claude 提問' },
    title: '請選擇下方選項',
    description: truncate(description, 4000),
    footer: { text: '點擊按鈕選擇，或點「其他」自訂回答' },
    timestamp: new Date().toISOString(),
  };
}

// ─── AskUserQuestion 單題步驟 Embed ─────────────────

/**
 * 建構單題步驟 Embed（逐題顯示，含進度指示與已答摘要）
 * @param askState - 目前的提問狀態（含問題列表、已答內容、進度）
 * @returns 單題步驟 Embed
 */
export function buildAskQuestionStepEmbed(askState: AskState): APIEmbed {
  const { currentQuestionIndex, totalQuestions, questions, collectedAnswers } = askState;
  const q = questions[currentQuestionIndex];

  const progressText = totalQuestions > 1
    ? `問題 ${currentQuestionIndex + 1}/${totalQuestions}`
    : '';

  const header = q.header ? `**${q.header}**` : '';
  const questionText = q.question || '';
  const optionsList = q.options
    ?.map((o, j) => `> ${j + 1}. **${o.label}**${o.description ? ` — ${o.description}` : ''}`)
    .join('\n') || '';

  const questionBlock = [header, questionText, optionsList].filter(Boolean).join('\n');

  // 已答問題摘要
  const answeredEntries = Object.entries(collectedAnswers);
  const answeredSummary = answeredEntries.length > 0
    ? answeredEntries
        .map(([idx, answer]) => {
          const answeredQ = questions[parseInt(idx, 10)];
          return `${answeredQ?.header || `問題 ${parseInt(idx, 10) + 1}`}: **${answer}**`;
        })
        .join('\n')
    : '';

  const description = answeredSummary
    ? `${answeredSummary}\n\n---\n\n${questionBlock}`
    : questionBlock;

  const footerText = q.multiSelect
    ? '選擇選項後點「確認選擇」提交，或點「其他」自訂回答'
    : '點擊按鈕選擇，或點「其他」自訂回答';

  return {
    color: COLORS.Permission,
    author: { name: `❓ Claude 提問${progressText ? ` — ${progressText}` : ''}` },
    title: q.header || '請選擇下方選項',
    description: truncate(description, 4000),
    footer: { text: footerText },
    timestamp: new Date().toISOString(),
  };
}

/**
 * 建構所有問題回答完成的摘要 Embed
 * @param askState - 已完成的提問狀態（含所有已答內容）
 * @returns 回答完成摘要 Embed
 */
export function buildAskCompletedEmbed(askState: AskState): APIEmbed {
  const summary = Object.entries(askState.collectedAnswers)
    .map(([idx, answer]) => {
      const q = askState.questions[parseInt(idx, 10)];
      return `**${q?.header || `問題 ${parseInt(idx, 10) + 1}`}**: ${answer}`;
    })
    .join('\n');

  return {
    color: COLORS.WaitingInput,
    author: { name: '✅ 已回答所有問題' },
    description: summary,
    timestamp: new Date().toISOString(),
  };
}

// ─── 孤兒 Thread 清理 Embed ─────────────────────────

/**
 * Bot 重啟時通知孤兒 Thread
 * @returns 孤兒 Thread 清理通知 Embed
 */
export function buildOrphanCleanupEmbed(): APIEmbed {
  return {
    color: COLORS.Notification,
    author: { name: '⚠️ Bot 已重啟' },
    description: '此 Session 已中斷。請重新使用 `/prompt` 開始新任務。',
    timestamp: new Date().toISOString(),
  };
}

// ─── 輔助函式 ───────────────────────────────────────

function buildFooterText(
  model?: string,
  permissionMode?: string,
  sessionId?: string,
): string {
  const parts = [
    model ? `🤖 ${model}` : null,
    permissionMode ? `🔒 ${PERMISSION_MODE_NAMES[permissionMode] || permissionMode}` : null,
    sessionId ? `Session ${sessionId.slice(0, 8)}` : null,
  ];
  return parts.filter(Boolean).join(' • ');
}
