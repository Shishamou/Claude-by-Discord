import { AttachmentBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { resolveThreadId } from '../modules/session-resolver.js';
import { formatTranscript } from '../modules/transcript-formatter.js';
import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';

/** /history 指令定義：匯出 Thread 對話記錄為 Markdown 檔案 */
export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('匯出目前 Thread 的對話記錄（Markdown 檔案）');

/**
 * 執行 /history 指令：格式化工作階段的對話記錄並以 Markdown 附件回傳
 * @param interaction - Discord 指令互動物件
 * @param config - Bot 設定檔
 * @param store - 工作階段狀態儲存
 * @returns 無回傳值
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
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
  if (!session || !session.transcript || session.transcript.length === 0) {
    await interaction.reply({ content: '⚠️ 此 Thread 沒有對話記錄', flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReplyEphemeral(interaction);

  const formatted = formatTranscript(session.transcript);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const filename = `history-${timestamp}.md`;

  const attachment = new AttachmentBuilder(Buffer.from(formatted, 'utf-8'), { name: filename });

  await editReply(interaction, {
    content: `📋 對話紀錄（${session.transcript.length} 筆）`,
    files: [attachment],
  });
}
