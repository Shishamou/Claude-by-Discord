import type { ThreadChannel, Message } from 'discord.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Stream' });
import type { UsageStore } from '../effects/usage-store.js';
import { sendInThread, sendPlainInThread, editMessageText, sendTextInThread } from '../effects/discord-sender.js';
import {
  buildToolUseEmbed,
  buildErrorEmbed,
} from '../modules/embeds.js';
import { extractAssistantText, extractToolUse, extractResult } from '../modules/message-parser.js';
import { calculateTokenUsage } from '../modules/token-usage.js';
import { truncate, formatForDiscord } from '../modules/formatters.js';

/** 不輸出工具呼叫 Embed 的工具名稱（大小寫不敏感），用以降低 Thread 雜訊 */
const SILENT_TOOL_EMBEDS = new Set(['skill', 'bash']);

/** 串流處理器的依賴注入介面 */
export interface StreamHandlerDeps {
  store: StateStore;
  threadId: string;
  thread: ThreadChannel;
  cwd: string;
  streamUpdateIntervalMs: number;
  usageStore: UsageStore;
}

/**
 * 串流累積狀態
 */
interface StreamState {
  currentText: string;
  currentMessage: Message | null;
  lastUpdateTime: number;
  updateTimer: ReturnType<typeof setTimeout> | null;
}

function createStreamState(): StreamState {
  return {
    currentText: '',
    currentMessage: null,
    lastUpdateTime: 0,
    updateTimer: null,
  };
}

/**
 * 節流更新串流文字到 Discord
 */
async function throttledStreamUpdate(
  state: StreamState,
  deps: StreamHandlerDeps,
): Promise<void> {
  const now = Date.now();
  const elapsed = now - state.lastUpdateTime;

  if (elapsed < deps.streamUpdateIntervalMs) {
    if (!state.updateTimer) {
      state.updateTimer = setTimeout(() => {
        state.updateTimer = null;
        flushStreamUpdate(state, deps).catch((err) =>
          log.error({ err }, '串流更新錯誤'),
        );
      }, deps.streamUpdateIntervalMs - elapsed);
    }
    return;
  }

  await flushStreamUpdate(state, deps);
}

const STREAM_MAX_LEN = 2000;

/**
 * 格式化串流文字（超過 Discord 上限時顯示尾段）
 */
function formatStreamingText(text: string): string {
  if (text.length <= STREAM_MAX_LEN) return text;
  return '…' + text.slice(-(STREAM_MAX_LEN - 1));
}

/**
 * 實際執行串流文字更新（純文字）
 */
async function flushStreamUpdate(
  state: StreamState,
  deps: StreamHandlerDeps,
): Promise<void> {
  if (!state.currentText) return;

  state.lastUpdateTime = Date.now();
  const displayText = formatStreamingText(state.currentText);

  try {
    if (state.currentMessage) {
      await editMessageText(state.currentMessage, displayText);
    } else {
      state.currentMessage = await sendPlainInThread(deps.thread, displayText);
    }
  } catch (err) {
    log.error({ err }, '串流文字更新錯誤');
  }
}

/**
 * 處理單一 SDK 訊息，依訊息類型轉發至對應的 Discord Thread
 *
 * @param message - Claude SDK 回傳的訊息
 * @param deps - 串流處理器所需的依賴
 * @param streamState - 串流累積狀態（用於節流文字更新）
 * @returns 無回傳值
 */
export async function handleSDKMessage(
  message: SDKMessage,
  deps: StreamHandlerDeps,
  streamState: StreamState,
): Promise<void> {
  const { store, threadId, thread, cwd } = deps;

  switch (message.type) {
    case 'system': {
      if ('subtype' in message) {
        if (message.subtype === 'init') {
          store.updateSession(threadId, { sessionId: message.session_id });
          deps.usageStore.recordSessionStart();
          log.info({ threadId, sessionId: message.session_id }, 'Session 初始化');
        }
      }
      break;
    }

    case 'stream_event': {
      const event = (message as { event: Record<string, unknown> }).event;
      if (
        event.type === 'content_block_delta' &&
        typeof event.delta === 'object' &&
        event.delta !== null
      ) {
        const delta = event.delta as Record<string, unknown>;
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          streamState.currentText += delta.text;
          await throttledStreamUpdate(streamState, deps);
        }
      }
      break;
    }

    case 'assistant': {
      const text = extractAssistantText(message);

      // 清除排程中的節流更新
      if (streamState.updateTimer) {
        clearTimeout(streamState.updateTimer);
        streamState.updateTimer = null;
      }

      // 記錄 transcript
      const session = store.getSession(threadId);
      if (text && session?.transcript) {
        session.transcript.push({
          timestamp: new Date(),
          type: 'assistant',
          content: text.slice(0, 2000),
        });
      }

      if (text) {
        const formatted = formatForDiscord(text);
        if (formatted.length <= 2000 && streamState.currentMessage) {
          // 文字在 2000 字以內，直接編輯串流訊息
          try {
            await editMessageText(streamState.currentMessage, formatted);
          } catch {
            // 編輯失敗則重新發送
            await sendTextInThread(thread, formatted);
          }
        } else {
          // 文字超過 2000 字或無串流訊息，刪除串流訊息後分段發送
          if (streamState.currentMessage) {
            try {
              await streamState.currentMessage.delete();
            } catch {
              // 訊息可能已被刪除
            }
          }
          await sendTextInThread(thread, formatted);
        }
      }

      // 重置串流狀態
      streamState.currentText = '';
      streamState.currentMessage = null;

      // 擷取工具呼叫
      const toolCalls = extractToolUse(message);
      for (const tool of toolCalls) {
        store.recordToolUse(threadId, tool.toolName);
        log.info({ threadId, tool: tool.toolName }, '工具呼叫');

        // 記錄 transcript
        if (session?.transcript) {
          session.transcript.push({
            timestamp: new Date(),
            type: 'tool_use',
            content: JSON.stringify(tool.toolInput).slice(0, 500),
            toolName: tool.toolName,
          });
        }

        // Skill 與 Bash 工具呼叫不輸出 Embed（降低 Thread 雜訊），仍保留計數與 transcript
        if (SILENT_TOOL_EMBEDS.has(tool.toolName.toLowerCase())) continue;

        const embed = buildToolUseEmbed(
          tool.toolName,
          tool.toolInput as Record<string, unknown>,
          cwd,
        );
        await sendInThread(thread, embed);
      }
      break;
    }

    case 'result': {
      const result = extractResult(message);
      const session = store.getSession(threadId);

      const usage = calculateTokenUsage(result.usage);

      // 記錄 transcript
      if (session?.transcript) {
        session.transcript.push({
          timestamp: new Date(),
          type: result.success ? 'result' : 'error',
          content: (result.text || '').slice(0, 2000),
        });
      }

      // 記錄全域用量
      deps.usageStore.recordResult(threadId, usage, result.costUsd, result.durationMs);

      if (result.success) {
        // 成功時不再發送統計 embed，回應文字已在 assistant 訊息中發送
        log.info({ threadId, tokens: usage, cost: result.costUsd, durationMs: result.durationMs }, '收到結果');
      } else {
        log.warn({ threadId, error: truncate(result.text || '', 100) }, '收到錯誤結果');
        const embed = buildErrorEmbed(result.text || '執行過程中發生錯誤');
        await sendInThread(thread, embed);
      }

      break;
    }

    case 'tool_progress': {
      break;
    }

    default:
      break;
  }
}

/**
 * 建立 SDK 訊息處理函式，綁定依賴與串流狀態
 *
 * @param deps - 串流處理器所需的依賴
 * @returns 接收 SDK 訊息的非同步 callback
 */
export function createMessageHandler(deps: StreamHandlerDeps) {
  const streamState = createStreamState();

  return async (message: SDKMessage): Promise<void> => {
    try {
      await handleSDKMessage(message, deps, streamState);
    } catch (error) {
      log.error({ err: error }, '處理訊息時發生錯誤');
    }
  };
}
