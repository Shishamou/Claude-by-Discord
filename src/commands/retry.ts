import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { truncate } from '../modules/formatters.js';

const log = logger.child({ module: 'Retry' });
import { resolveThreadId } from '../modules/session-resolver.js';
import { buildRetryEmbed } from '../modules/embeds.js';
import { deferReply, editReply, sendInThread } from '../effects/discord-sender.js';

/** /retry 指令定義：重新執行 Thread 中最後一次提示 */
export const data = new SlashCommandBuilder()
  .setName('retry')
  .setDescription('重新執行目前 Thread 的最後一次提示');

/**
 * 執行 /retry 指令：中斷現有工作階段並以相同提示建立新工作階段重新執行
 * @param interaction - Discord 指令互動物件
 * @param config - Bot 設定檔
 * @param store - 工作階段狀態儲存
 * @param startClaudeQuery - 啟動 Claude 查詢的回呼函式
 * @returns 無回傳值
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.user.id, interaction.channelId, config, parentId);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  const threadId = resolveThreadId(interaction, store);
  if (!threadId) {
    await interaction.reply({ content: '⚠️ 請在工作階段的 Thread 中使用此指令', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const session = store.getSession(threadId);
  if (!session) {
    await interaction.reply({ content: '⚠️ 找不到可重試的工作階段', flags: [MessageFlags.Ephemeral] });
    return;
  }

  // 只允許在非執行中狀態重試
  if (session.status === 'running' || session.status === 'awaiting_permission') {
    await interaction.reply({ content: '⚠️ 任務仍在執行中，無法重試', flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReply(interaction);

  // 中斷現有的 session（如果尚未中斷）
  if (!session.abortController.signal.aborted) {
    session.abortController.abort();
  }

  // 建立新 session（不 resume，重新執行）
  const newAbortController = new AbortController();
  const newSession: SessionState = {
    sessionId: null,
    status: 'running',
    threadId,
    userId: session.userId,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: session.promptText,
    cwd: session.cwd,
    model: session.model,
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: newAbortController,
    transcript: [],
  };

  store.setSession(threadId, newSession);

  // 發送重試 Embed
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const retryEmbed = buildRetryEmbed(session.promptText);
    await sendInThread(channel, retryEmbed);
  }

  await editReply(interaction, { content: '🔄 正在重新執行...' });

  // 啟動新查詢
  startClaudeQuery(newSession, threadId).catch(async (error) => {
    log.error({ err: error, threadId, prompt: truncate(session.promptText, 40) }, '查詢錯誤');
    store.updateSession(threadId, { status: 'error' });
  });
}
