import { MessageFlags, type Interaction, type Client } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import * as statusCmd from '../commands/status.js';
import * as stopCmd from '../commands/stop.js';
import * as promptCmd from '../commands/prompt.js';
import * as historyCmd from '../commands/history.js';
import * as retryCmd from '../commands/retry.js';
import type { RateLimitStore } from '../effects/rate-limit-store.js';
import type { UsageStore } from '../effects/usage-store.js';
import {
  handleAskOptionClick,
  handleAskSubmit,
  handleAskOther,
  handleAskModalSubmit,
} from './ask-handler.js';

/** 互動處理器的依賴注入介面 */
export interface InteractionHandlerDeps {
  config: BotConfig;
  store: StateStore;
  client: Client;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
  rateLimitStore: RateLimitStore;
  usageStore: UsageStore;
}

/**
 * 建立互動處理器，路由 Slash Commands、Button 與 Modal 互動至對應邏輯
 *
 * @param deps - 互動處理器所需的依賴
 * @returns 處理 Discord 互動事件的非同步函式
 */
export function createInteractionHandler(deps: InteractionHandlerDeps) {
  const askDeps = { store: deps.store };

  return async function handleInteraction(interaction: Interaction): Promise<void> {
    // Slash Commands
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'prompt':
          await promptCmd.execute(
            interaction,
            deps.config,
            deps.store,
            deps.startClaudeQuery,
            deps.rateLimitStore,
          );
          break;

        case 'stop':
          await stopCmd.execute(interaction, deps.config, deps.store, deps.client);
          break;

        case 'status':
          await statusCmd.execute(interaction, deps.config, deps.store, deps.usageStore);
          break;

        case 'history':
          await historyCmd.execute(interaction, deps.config, deps.store);
          break;

        case 'retry':
          await retryCmd.execute(interaction, deps.config, deps.store, deps.startClaudeQuery);
          break;

        default:
          await interaction.reply({
            content: '❌ 未知的指令',
            flags: [MessageFlags.Ephemeral],
          });
      }
      return;
    }

    // Button 互動
    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId.startsWith('approve:')) {
        const threadId = customId.slice('approve:'.length);
        const pending = deps.store.getPendingApproval(threadId);

        if (!pending) {
          await interaction.reply({ content: '⚠️ 此請求已過期', flags: [MessageFlags.Ephemeral] });
          return;
        }

        // 先回應互動（Discord 3 秒視窗），再 resolve Promise，
        // 避免 SDK microtask flood 佔住 event loop 導致互動逾時
        await interaction.reply({ content: '✅ 已核准', flags: [MessageFlags.Ephemeral] });

        deps.store.resolvePendingApproval(threadId, {
          behavior: 'allow',
          updatedInput: pending.toolInput,
        });
        return;
      }

      if (customId.startsWith('deny:')) {
        const threadId = customId.slice('deny:'.length);
        const pending = deps.store.getPendingApproval(threadId);

        if (!pending) {
          await interaction.reply({ content: '⚠️ 此請求已過期', flags: [MessageFlags.Ephemeral] });
          return;
        }

        // 先回應互動（Discord 3 秒視窗），再 resolve Promise
        await interaction.reply({ content: '❌ 已拒絕', flags: [MessageFlags.Ephemeral] });

        deps.store.resolvePendingApproval(threadId, {
          behavior: 'deny',
          message: '使用者透過按鈕拒絕',
        });
        return;
      }

      // 確認中斷
      if (customId.startsWith('confirm_stop:')) {
        const threadId = customId.slice('confirm_stop:'.length);
        const session = deps.store.getSession(threadId);

        if (!session) {
          await interaction.reply({ content: '⚠️ 此任務已結束', flags: [MessageFlags.Ephemeral] });
          return;
        }

        await interaction.reply({ content: '🛑 任務已中斷', flags: [MessageFlags.Ephemeral] });
        await stopCmd.executeStop(threadId, deps.store, deps.client);
        return;
      }

      // 取消中斷
      if (customId.startsWith('cancel_stop:')) {
        await interaction.reply({ content: '✅ 已取消中斷', flags: [MessageFlags.Ephemeral] });
        return;
      }

      // AskUserQuestion 選項按鈕
      if (customId.startsWith('ask:')) {
        const parts = customId.slice('ask:'.length).split(':');
        let threadId: string, qIdx: number, optIdx: number;
        if (parts.length >= 3) {
          threadId = parts[0];
          qIdx = parseInt(parts[1], 10);
          optIdx = parseInt(parts[2], 10);
        } else {
          // 舊格式相容：ask:{threadId}:{optIdx}
          threadId = parts[0];
          qIdx = 0;
          optIdx = parseInt(parts[1], 10);
        }
        await handleAskOptionClick(interaction, threadId, qIdx, optIdx, askDeps);
        return;
      }

      // AskUserQuestion 多選確認按鈕
      if (customId.startsWith('ask_submit:')) {
        const parts = customId.slice('ask_submit:'.length).split(':');
        const threadId = parts[0];
        const qIdx = parseInt(parts[1], 10);
        await handleAskSubmit(interaction, threadId, qIdx, askDeps);
        return;
      }

      // AskUserQuestion「其他」按鈕 → 顯示 Modal
      if (customId.startsWith('ask_other:')) {
        const parts = customId.slice('ask_other:'.length).split(':');
        const threadId = parts[0];
        const qIdx = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
        await handleAskOther(interaction, threadId, qIdx, askDeps);
        return;
      }
    }

    // Modal 提交（AskUserQuestion 自訂回答）
    if (interaction.isModalSubmit()) {
      const { customId } = interaction;

      if (customId.startsWith('ask_modal:')) {
        const parts = customId.slice('ask_modal:'.length).split(':');
        const threadId = parts[0];
        const qIdx = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
        await handleAskModalSubmit(interaction, threadId, qIdx, askDeps);
        return;
      }
    }
  };
}
