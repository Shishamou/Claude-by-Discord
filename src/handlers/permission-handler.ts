import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadChannel } from 'discord.js';
import type { StateStore } from '../effects/state-store.js';
import type { AskState, PendingApproval } from '../types.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Permission' });
import { buildPermissionRequestEmbed, buildAskQuestionStepEmbed } from '../modules/embeds.js';
import { sendEmbedWithApprovalButtons, sendEmbedWithAskButtons, buildQuestionButtons, sendTextInThread } from '../effects/discord-sender.js';

/** 權限處理器的依賴注入介面 */
export interface PermissionHandlerDeps {
  store: StateStore;
  threadId: string;
  thread: ThreadChannel;
  cwd: string;
}

/** 無需使用者審批、直接放行的工具名稱 */
const AUTO_APPROVE_TOOLS = new Set(['Skill', 'Task']);

/** Bash 指令自動放行的 pattern（唯讀或網路請求類） */
const AUTO_APPROVE_BASH_PATTERNS = [
  /^\s*curl\b/,
  /^\s*wget\b/,
];

/**
 * 判斷是否自動核准此工具呼叫，不需要 Discord 審批
 */
function shouldAutoApprove(toolName: string, input: unknown): boolean {
  if (AUTO_APPROVE_TOOLS.has(toolName)) return true;

  if (toolName === 'Bash') {
    const command = (input as Record<string, unknown>)?.command;
    if (typeof command === 'string') {
      return AUTO_APPROVE_BASH_PATTERNS.some((p) => p.test(command));
    }
  }

  return false;
}

/**
 * 建立 canUseTool callback，將 SDK 權限請求橋接到 Discord 按鈕
 *
 * 核心機制：建立 Promise 並將 resolve 儲存到 StateStore，
 * SDK 暫停等待使用者在 Discord 點擊 Approve/Deny
 *
 * @param deps - 權限處理器所需的依賴
 * @returns 符合 SDK CanUseTool 型別的非同步 callback
 */
export function createCanUseTool(deps: PermissionHandlerDeps): CanUseTool {
  return async (toolName, input, options) => {
    const { store, threadId, thread, cwd } = deps;

    // 自動放行：Skill、Task 及 curl/wget 等指令，不送 Discord 審批
    if (shouldAutoApprove(toolName, input)) {
      log.info({ threadId, tool: toolName }, '自動核准');
      return { behavior: 'allow', updatedInput: input as Record<string, unknown> };
    }

    log.info({ threadId, tool: toolName }, '等待權限審批');

    // AskUserQuestion 特殊處理：逐題顯示選項按鈕，支援多選與多問題
    if (toolName === 'AskUserQuestion' || toolName === 'AskUser') {
      const typedInput = input as Record<string, unknown>;
      const rawQuestions = typedInput.questions as Array<{
        question?: string;
        header?: string;
        options?: Array<{ label?: string; description?: string }>;
        multiSelect?: boolean;
      }> | undefined;

      if (rawQuestions && rawQuestions.length > 0 && rawQuestions[0]?.options?.length) {
        // 正規化 questions
        const questions = rawQuestions.map((q) => ({
          question: q.question || '',
          header: q.header || '',
          options: (q.options || []).map((o) => ({
            label: o.label || '選項',
            description: o.description || '',
          })),
          multiSelect: q.multiSelect || false,
        }));

        const askState: AskState = {
          totalQuestions: questions.length,
          currentQuestionIndex: 0,
          collectedAnswers: {},
          selectedOptions: new Set(),
          isMultiSelect: questions[0].multiSelect,
          questions,
        };

        const embed = buildAskQuestionStepEmbed(askState);
        const buttons = buildQuestionButtons(threadId, askState);
        const message = await sendEmbedWithAskButtons(thread, embed, buttons);

        // @mention 通知使用者需要回答問題
        const session = store.getSession(threadId);
        if (session?.userId) {
          await sendTextInThread(thread, `<@${session.userId}> Claude 有問題需要你回答。`);
        }

        return new Promise((resolve) => {
          const approval: PendingApproval = {
            toolName,
            toolInput: input,
            messageId: message.id,
            resolve: (result) => {
              if (result.behavior === 'allow') {
                resolve({
                  behavior: 'allow',
                  updatedInput: (result.updatedInput as Record<string, unknown>) ?? input,
                });
              } else {
                resolve({
                  behavior: 'deny',
                  message: result.message || '使用者拒絕',
                });
              }
            },
            createdAt: new Date(),
            askState,
          };
          store.setPendingApproval(threadId, approval);

          if (options.signal) {
            options.signal.addEventListener('abort', () => {
              const pending = store.getPendingApproval(threadId);
              if (pending && pending.messageId === message.id) {
                store.resolvePendingApproval(threadId, {
                  behavior: 'deny',
                  message: '任務已中斷',
                });
              }
            }, { once: true });
          }
        });
      }
    }

    // 建構權限請求 Embed
    const embed = buildPermissionRequestEmbed(toolName, input, cwd);

    // 發送 Embed + Approve/Deny 按鈕到 Thread
    const message = await sendEmbedWithApprovalButtons(thread, embed, threadId);

    // @mention 通知使用者需要審批
    const session = store.getSession(threadId);
    if (session?.userId) {
      await sendTextInThread(thread, `<@${session.userId}> 有工具需要你審批。`);
    }

    // 建立 Promise，resolve 儲存到 StateStore
    return new Promise((resolve) => {
      const approval: PendingApproval = {
        toolName,
        toolInput: input,
        messageId: message.id,
        resolve: (result) => {
          if (result.behavior === 'allow') {
            log.info({ threadId, tool: toolName }, '使用者核准');
            resolve({
              behavior: 'allow',
              updatedInput: (result.updatedInput as Record<string, unknown>) ?? input,
            });
          } else {
            log.info({ threadId, tool: toolName }, '使用者拒絕');
            resolve({
              behavior: 'deny',
              message: result.message || '使用者拒絕',
            });
          }
        },
        createdAt: new Date(),
      };

      store.setPendingApproval(threadId, approval);

      // 如果 AbortSignal 觸發，自動拒絕
      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            const pending = store.getPendingApproval(threadId);
            if (pending && pending.messageId === message.id) {
              store.resolvePendingApproval(threadId, {
                behavior: 'deny',
                message: '任務已中斷',
              });
            }
          },
          { once: true },
        );
      }
    });
  };
}
