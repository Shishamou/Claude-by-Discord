import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { UsageStore } from '../effects/usage-store.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { buildStatusEmbed, buildGlobalStatusEmbed } from '../modules/embeds.js';
import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';

/** /status 指令定義：查看 Claude Code 執行狀態 */
export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('查看目前 Claude Code 執行狀態');

/**
 * 執行 /status 指令：在 Thread 內顯示該工作階段狀態，在頻道內顯示全域 Bot 狀態
 * @param interaction - Discord 指令互動物件
 * @param config - Bot 設定檔
 * @param store - 工作階段狀態儲存
 * @param usageStore - Token 用量儲存
 * @returns 無回傳值
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  usageStore: UsageStore,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.channelId, config, parentId);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReplyEphemeral(interaction);

  // 若在 Thread 內，顯示該 session 狀態（含 Token 用量）
  const channel = interaction.channel;
  if (channel?.isThread()) {
    const session = store.getSession(channel.id);
    const sessionUsage = usageStore.getSessionUsage(channel.id);
    const embed = buildStatusEmbed(session, sessionUsage);
    await editReply(interaction, { embeds: [embed] });
    return;
  }

  // 不在 Thread 內，顯示全域 Bot 狀態
  const activeSessions = store.getAllActiveSessions();
  const globalStats = usageStore.getGlobalStats();
  const embed = buildGlobalStatusEmbed(globalStats, activeSessions);
  await editReply(interaction, { embeds: [embed] });
}
