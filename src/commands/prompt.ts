import {
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { BotConfig, SessionState, Project } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import type { RateLimitStore } from '../effects/rate-limit-store.js';
import { logger } from '../effects/logger.js';
import { canExecuteCommand, isAllowedCwd } from '../modules/permissions.js';

const log = logger.child({ module: 'Claude' });
import { buildSessionStartEmbed, buildErrorEmbed } from '../modules/embeds.js';
import { truncate } from '../modules/formatters.js';
import { checkRateLimit, recordRequest } from '../modules/rate-limiter.js';
import {
  deferReply,
  editReply,
  createThread,
  sendInThread,
} from '../effects/discord-sender.js';

/**
 * 根據專案清單動態建構 /prompt Slash Command 定義
 * @param projects - 允許選擇的專案清單
 * @returns 包含 message、cwd、model 選項的 SlashCommandBuilder
 */
export function buildPromptCommand(projects: Project[]) {
  const builder = new SlashCommandBuilder()
    .setName('prompt')
    .setDescription('傳送提示給 Claude Code')
    .addStringOption((opt) =>
      opt.setName('message').setDescription('提示內容').setRequired(true),
    )
    .addStringOption((opt) => {
      opt.setName('cwd').setDescription('工作目錄').setRequired(true);
      for (const p of projects.slice(0, 25)) {
        opt.addChoices({ name: `${p.name} — ${p.path}`, value: p.path });
      }
      return opt;
    })
    .addStringOption((opt) =>
      opt
        .setName('model')
        .setDescription('模型名稱（選填）')
        .addChoices(
          { name: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
          { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
          { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
        ),
    );
  return builder;
}

/**
 * 執行 /prompt 指令：驗證權限與速率限制後，建立 Thread 並啟動 Claude 查詢
 * @param interaction - Discord 指令互動物件
 * @param config - Bot 設定檔
 * @param store - 工作階段狀態儲存
 * @param startClaudeQuery - 啟動 Claude 查詢的回呼函式
 * @param rateLimitStore - 速率限制儲存（選填）
 * @returns 無回傳值
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  config: BotConfig,
  store: StateStore,
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>,
  rateLimitStore?: RateLimitStore,
): Promise<void> {
  const parentId = interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
  const auth = canExecuteCommand(interaction.user.id, interaction.channelId, config, parentId);
  if (!auth.allowed) {
    await interaction.reply({ content: `❌ ${auth.reason}`, flags: [MessageFlags.Ephemeral] });
    return;
  }

  // Rate Limit 檢查
  if (rateLimitStore) {
    const rateLimitResult = checkRateLimit(
      rateLimitStore.getEntry(interaction.user.id),
      { windowMs: config.rateLimitWindowMs, maxRequests: config.rateLimitMaxRequests },
      Date.now(),
    );
    if (!rateLimitResult.allowed) {
      const waitSec = Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000);
      await interaction.reply({
        content: `⚠️ 操作過於頻繁，請在 ${waitSec} 秒後再試`,
        flags: [MessageFlags.Ephemeral],
      });
      return;
    }
  }

  const message = interaction.options.getString('message', true);
  const cwd = interaction.options.getString('cwd', true);
  const model = interaction.options.getString('model') || config.defaultModel;

  if (!isAllowedCwd(cwd, config.projects)) {
    await interaction.reply({ content: '❌ 工作目錄不在允許的專案清單中', flags: [MessageFlags.Ephemeral] });
    return;
  }

  await deferReply(interaction);

  // 記錄 rate limit
  if (rateLimitStore) {
    rateLimitStore.setEntry(
      interaction.user.id,
      recordRequest(
        rateLimitStore.getEntry(interaction.user.id),
        Date.now(),
        config.rateLimitWindowMs,
      ),
    );
  }

  // 建立 Thread
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await editReply(interaction, { content: '❌ 此指令只能在文字頻道使用' });
    return;
  }

  const threadName = `Session: ${truncate(message, 30)}`;
  const thread = await createThread(channel as TextChannel, threadName);

  // 建立 Session
  const abortController = new AbortController();
  const session: SessionState = {
    sessionId: null,
    status: 'running',
    threadId: thread.id,
    userId: interaction.user.id,
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: message,
    cwd,
    model,
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController,
    transcript: [],
  };

  store.setSession(thread.id, session);

  // 記錄初始使用者訊息到 transcript
  session.transcript.push({
    timestamp: new Date(),
    type: 'user',
    content: message.slice(0, 2000),
  });

  // 發送開始 Embed 到 Thread
  const startEmbed = buildSessionStartEmbed(message, cwd, model);
  await sendInThread(thread, startEmbed);

  await editReply(interaction, {
    content: `🚀 任務已開始 → <#${thread.id}>`,
  });

  // 啟動 Claude 查詢（非同步，不 await）
  startClaudeQuery(session, thread.id).catch(async (error) => {
    log.error({ err: error, threadId: thread.id, prompt: truncate(message, 40) }, '查詢錯誤');
    const errorEmbed = buildErrorEmbed(
      error instanceof Error ? error.message : String(error),
    );
    try {
      await sendInThread(thread, errorEmbed);
    } catch {
      // Thread 可能已不存在
    }
    store.clearSession(thread.id);
  });
}
