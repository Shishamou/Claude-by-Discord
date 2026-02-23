import { Client, GatewayIntentBits, MessageFlags, type Interaction, type Message } from 'discord.js';
import type { BotConfig } from '../types.js';
import { logger } from './logger.js';

const log = logger.child({ module: 'Discord' });

/**
 * 建立並登入 Discord Client，綁定互動與訊息事件
 * @param config - Bot 設定
 * @param onInteraction - Slash Command / Button / Modal 互動處理器
 * @param onMessageCreate - Thread 中的普通訊息處理器（續問用）
 * @returns 已登入的 Discord Client 實例
 */
export async function createDiscordClient(
  config: BotConfig,
  onInteraction: (interaction: Interaction) => Promise<void>,
  onMessageCreate?: (message: Message) => Promise<void>,
): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // clientReady 事件由 index.ts 統一處理顯示
  client.once('clientReady', () => {});

  client.on('interactionCreate', async (interaction) => {
    // 按鈕與 Modal 互動：在 event loop 可能因 SDK streaming 而延遲的情況下，
    // 於業務邏輯執行前立即 defer，確保在 Discord 3 秒視窗內送出 ACK。
    // ask_other: 需以 showModal 作為 first response，不能預先 defer。
    if (interaction.isButton() && !interaction.customId.startsWith('ask_other:')) {
      const useUpdate =
        interaction.customId.startsWith('ask:') ||
        interaction.customId.startsWith('ask_submit:');
      if (useUpdate) {
        await interaction.deferUpdate().catch(() => {});
      } else {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => {});
      }
    } else if (interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => {});
    }

    try {
      await onInteraction(interaction);
    } catch (error) {
      log.error({ err: error }, '互動處理錯誤');

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: '❌ 指令執行時發生錯誤', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        } else {
          await interaction.reply({ content: '❌ 指令執行時發生錯誤', flags: [MessageFlags.Ephemeral] }).catch(() => {});
        }
      }
    }
  });

  // 監聽 Thread 中的普通訊息（續問用）
  if (onMessageCreate) {
    client.on('messageCreate', async (message) => {
      try {
        await onMessageCreate(message);
      } catch (error) {
        log.error({ err: error }, '訊息處理錯誤');
      }
    });
  }

  await client.login(config.discordToken);
  return client;
}

/**
 * 安全關閉 Discord Client
 * @param client - 要關閉的 Client 實例
 */
export async function destroyDiscordClient(client: Client): Promise<void> {
  client.destroy();
}
