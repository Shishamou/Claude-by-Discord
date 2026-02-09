import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type ThreadChannel,
} from 'discord.js';
import type { BotConfig } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { buildStopPreviewEmbed, buildStopConfirmEmbed } from '../modules/embeds.js';
import { deferReply, editReply, sendInThread } from '../effects/discord-sender.js';
import { resolveThreadId } from '../modules/session-resolver.js';

/** /stop 指令定義：中斷正在執行的 Claude Code 任務 */
export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('中斷目前正在執行的 Claude Code 任務');

/**
 * 執行 /stop 指令：顯示任務摘要與確認按鈕，等待使用者確認後中斷
 * @param interaction - Discord 指令互動物件
 * @param config - Bot 設定檔
 * @param store - 工作階段狀態儲存
 * @param client - Discord Client 實例
 * @returns 無回傳值
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  client: Client,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.user.id, interaction.channelId, config, parentId);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReply(interaction);

  const threadId = resolveThreadId(interaction, store);
  if (!threadId) {
    const activeCount = store.getActiveSessionCount();
    if (activeCount > 1) {
      await editReply(interaction, { content: '⚠️ 有多個進行中的任務，請在目標 Thread 中使用此指令' });
    } else {
      await editReply(interaction, { content: '⚠️ 目前沒有正在執行的任務' });
    }
    return;
  }

  const session = store.getSession(threadId);
  if (!session) {
    await editReply(interaction, { content: '⚠️ 目前沒有正在執行的任務' });
    return;
  }

  // 顯示摘要 + 確認按鈕
  const durationMs = Date.now() - session.startedAt.getTime();
  const embed = buildStopPreviewEmbed(session, durationMs);

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`confirm_stop:${threadId}`)
    .setLabel('確認中斷')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('🛑');

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`cancel_stop:${threadId}`)
    .setLabel('取消')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

  await editReply(interaction, { embeds: [embed], components: [row] });
}

/**
 * 執行實際的中斷邏輯（由 confirm_stop 按鈕觸發）
 * @param threadId - 要中斷的工作階段所在 Thread ID
 * @param store - 工作階段狀態儲存
 * @param client - Discord Client 實例，用於取得 Thread 頻道
 * @returns 無回傳值
 */
export async function executeStop(
  threadId: string,
  store: StateStore,
  client: Client,
): Promise<void> {
  const session = store.getSession(threadId);
  if (!session) return;

  // 中斷執行
  session.abortController.abort();

  // 如有待審批，自動拒絕
  if (session.pendingApproval) {
    store.resolvePendingApproval(threadId, {
      behavior: 'deny',
      message: '使用者已中斷任務',
    });
  }

  // 計算執行時間
  const durationMs = Date.now() - session.startedAt.getTime();

  // 發送中斷確認到 Thread
  try {
    const channel = await client.channels.fetch(threadId);
    if (channel?.isThread()) {
      const thread = channel as ThreadChannel;
      const embed = buildStopConfirmEmbed(
        { toolCount: session.toolCount, tools: session.tools },
        durationMs,
      );
      await sendInThread(thread, embed);
      await thread.setArchived(true);
    }
  } catch {
    // Thread 可能已不存在
  }

  store.clearSession(threadId);
}
