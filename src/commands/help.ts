import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { BotConfig, ChannelConfig } from '../types.js';
import { canExecuteCommand } from '../modules/permissions.js';
import { deferReplyEphemeral, editReply } from '../effects/discord-sender.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'Help' });

/** Discord 單則訊息長度上限 */
const MESSAGE_LIMIT = 2000;

/** /help 指令定義：顯示頻道使用說明 */
export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('顯示此頻道的使用說明');

/**
 * 產生內建的預設使用說明（頻道未設定 help 文件時使用）
 * @param channel - 頻道設定
 * @param config - Bot 全域設定
 * @returns markdown 格式的說明文字
 */
export function buildDefaultHelp(channel: ChannelConfig, config: BotConfig): string {
  const model = channel.model ?? config.defaultModel;
  const effort = channel.effort ?? config.defaultEffort;

  return [
    `## 📖 ${channel.name} 頻道使用說明`,
    '',
    `**專案路徑**：\`${channel.path}\``,
    `**模型**：${model}${channel.model ? '' : '（全域預設）'}`,
    `**Effort**：${effort ?? 'CLI 預設'}${channel.effort ? '' : effort ? '（全域預設）' : ''}`,
    '',
    '### 怎麼使用',
    '- **開始任務** — 在頻道 @ 標注 Bot 並描述任務，Bot 會開新 Thread 執行（可附加圖片、PDF、文字檔）',
    '- **續問** — 在 Thread 內直接打字，保留完整上下文',
    '- **中止** — 點擊完成通知上的 🛑 按鈕，立即中止並顯示 `claude -r <session id>` 還原指令',
    '- **閒置回收** — Thread 超過 30 分鐘無新對話會自動中止',
    '',
    '### 指令',
    '- `/status` — 查看執行狀態與 Token 用量',
    '- `/help` — 顯示本說明',
  ].join('\n');
}

/**
 * 載入頻道的 help 文件內容；未設定或讀取失敗時回傳內建預設說明
 * @param channel - 頻道設定
 * @param config - Bot 全域設定
 * @returns markdown 說明文字
 */
export function loadHelpContent(channel: ChannelConfig, config: BotConfig): string {
  if (!channel.help) {
    return buildDefaultHelp(channel, config);
  }

  const helpPath = isAbsolute(channel.help) ? channel.help : resolve(channel.path, channel.help);
  try {
    const content = readFileSync(helpPath, 'utf-8').trim();
    if (content) return content;
    log.warn({ channel: channel.name, helpPath }, 'help 文件為空，改用內建說明');
  } catch (err) {
    log.warn({ err, channel: channel.name, helpPath }, '讀取 help 文件失敗，改用內建說明');
  }
  return `⚠️ 無法讀取 help 文件 \`${channel.help}\`，以下為內建說明：\n\n${buildDefaultHelp(channel, config)}`;
}

/**
 * 將長文字依行切分為符合 Discord 長度限制的多段
 * @param text - 原始文字
 * @returns 每段不超過 2000 字的字串陣列
 */
export function splitMessage(text: string): string[] {
  if (text.length <= MESSAGE_LIMIT) return [text];

  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    // 單行就超限時硬切
    if (line.length > MESSAGE_LIMIT) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += MESSAGE_LIMIT) {
        chunks.push(line.slice(i, i + MESSAGE_LIMIT));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MESSAGE_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * 執行 /help 指令：顯示頻道設定的 markdown 說明文件（未設定時顯示內建說明）
 * @param interaction - Discord 指令互動物件
 * @param config - Bot 設定檔
 * @returns 無回傳值
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.channelId, config, parentId);
  if (!auth.allowed || !auth.channel) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReplyEphemeral(interaction);

  const content = loadHelpContent(auth.channel, config);
  const [first, ...rest] = splitMessage(content);

  await editReply(interaction, { content: first });
  for (const chunk of rest) {
    await interaction.followUp({ content: chunk, flags: [MessageFlags.Ephemeral] });
  }
}
