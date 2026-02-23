import { config as loadEnv } from 'dotenv';
import type { ThreadChannel } from 'discord.js';
import { parseConfig, validateConfig } from './config.js';
import type { SessionState } from './types.js';
import { logger, printBanner } from './effects/logger.js';
import { truncate, formatDuration } from './modules/formatters.js';

const log = logger.child({ module: 'Bot' });
const claudeLog = logger.child({ module: 'Claude' });
import { StateStore } from './effects/state-store.js';
import { RateLimitStore } from './effects/rate-limit-store.js';
import { createDiscordClient, destroyDiscordClient } from './effects/discord-client.js';
import { createInteractionHandler } from './handlers/interaction-handler.js';
import { startQuery } from './effects/claude-bridge.js';
import { createMessageHandler } from './handlers/stream-handler.js';
import { createCanUseTool } from './handlers/permission-handler.js';
import { buildErrorEmbed, buildWaitingInputEmbed, buildOrphanCleanupEmbed } from './modules/embeds.js';
import { sendInThread } from './effects/discord-sender.js';
import { createThreadMessageHandler } from './handlers/thread-message-handler.js';
import { createMentionHandler } from './handlers/mention-handler.js';
import { UsageStore } from './effects/usage-store.js';
import { checkClaudeStatus } from './effects/startup-check.js';

// 載入 .env
loadEnv();

async function main() {
  // 解析與驗證設定
  const config = parseConfig(process.env as Record<string, string | undefined>);
  const errors = validateConfig(config);

  if (errors.length > 0) {
    log.fatal({ errors }, '設定驗證失敗');
    process.exit(1);
  }

  // 建立狀態儲存
  const store = new StateStore();
  const rateLimitStore = new RateLimitStore();
  const usageStore = new UsageStore();

  // Claude 查詢啟動函式
  async function startClaudeQuery(session: SessionState, threadId: string): Promise<void> {
    // 取得 Thread
    const channel = await client.channels.fetch(threadId);
    if (!channel?.isThread()) {
      throw new Error('無法取得 Thread');
    }
    const thread = channel as ThreadChannel;

    // 建立訊息處理器
    const messageHandler = createMessageHandler({
      store,
      threadId,
      thread,
      cwd: session.cwd,
      streamUpdateIntervalMs: config.streamUpdateIntervalMs,
      usageStore,
    });

    // 建立權限處理器
    const canUseTool = createCanUseTool({
      store,
      threadId,
      thread,
      cwd: session.cwd,
    });

    // 啟動 Claude 查詢（支援 resume + 圖片附件）
    claudeLog.info(
      { threadId, prompt: truncate(session.promptText, 60), model: session.model, cwd: session.cwd, resume: !!session.sessionId },
      '查詢開始',
    );
    const { sessionId } = await startQuery(session.promptText, {
      cwd: session.cwd,
      model: session.model,
      permissionMode: config.defaultPermissionMode,
      abortController: session.abortController,
      canUseTool,
      resume: session.sessionId ?? undefined,
      attachments: session.attachments,
      onMessage: (message) => {
        messageHandler(message);
      },
      onError: async (error) => {
        const s = store.getSession(threadId);
        claudeLog.error({ err: error, threadId, prompt: truncate(s?.promptText ?? '', 40) }, '執行錯誤');
        try {
          const embed = buildErrorEmbed(error.message);
          await sendInThread(thread, embed);
          // @mention 通知使用者
          const currentSession = store.getSession(threadId);
          if (currentSession?.userId) {
            if (thread.archived) await thread.setArchived(false);
            await thread.send(`<@${currentSession.userId}> 任務執行時發生錯誤。`);
          }
          await thread.setArchived(true);
        } catch {
          // Thread 可能已不存在
        }
        store.updateSession(threadId, { status: 'error' });
      },
      onComplete: async () => {
        const s = store.getSession(threadId);
        const elapsed = s ? Date.now() - s.startedAt.getTime() : 0;
        claudeLog.info({ threadId, prompt: truncate(s?.promptText ?? '', 40), duration: formatDuration(elapsed) }, '查詢完成');
        store.updateSession(threadId, { status: 'waiting_input' });

        try {
          // 發送等待輸入 Embed
          const waitEmbed = buildWaitingInputEmbed();
          await sendInThread(thread, waitEmbed);
          // @mention 通知使用者
          const currentSession = store.getSession(threadId);
          if (currentSession?.userId) {
            if (thread.archived) await thread.setArchived(false);
            await thread.send(`<@${currentSession.userId}> 任務已完成，可在此 Thread 續問或使用 \`/stop\` 結束。`);
          }
        } catch {
          // Thread 可能已不存在
        }
      },
    });

    if (sessionId) {
      store.updateSession(threadId, { sessionId });
    }
  }

  // 建立互動處理器
  let client: Awaited<ReturnType<typeof createDiscordClient>>;

  const handler = createInteractionHandler({
    config,
    store,
    get client() {
      return client;
    },
    startClaudeQuery,
    rateLimitStore,
    usageStore,
  });

  // 建立 Thread 訊息處理器（續問用）
  const threadMessageHandler = createThreadMessageHandler({
    config,
    store,
    get client() {
      return client;
    },
    startClaudeQuery,
  });

  // 建立 @mention 處理器（在頻道 @ Bot 自動以 Haiku 開啟對話）
  const mentionHandler = createMentionHandler({
    config,
    store,
    get client() {
      return client;
    },
    startClaudeQuery,
  });

  // 啟動 Discord Client
  client = await createDiscordClient(config, handler, async (message) => {
    await mentionHandler(message);
    await threadMessageHandler(message);
  });

  // 啟動時清理孤兒 Thread
  try {
    const mainChannel = await client.channels.fetch(config.discordChannelId);
    if (mainChannel && 'threads' in mainChannel) {
      const activeThreads = await (mainChannel as import('discord.js').TextChannel).threads.fetchActive();
      const botId = client.user?.id;
      let cleaned = 0;

      for (const [, thread] of activeThreads.threads) {
        // 只清理 Bot 建立的且不在 store 中的 Thread
        if (thread.ownerId === botId && !store.getSession(thread.id)) {
          try {
            await sendInThread(thread, buildOrphanCleanupEmbed());
            await thread.setArchived(true);
            cleaned++;
          } catch {
            // Thread 可能已被刪除
          }
        }
      }

      if (cleaned > 0) {
        log.info({ cleaned }, '已清理孤兒 Thread');
      }
    }
  } catch (error) {
    log.warn({ err: error }, '清理孤兒 Thread 失敗（非致命）');
  }

  // 啟動時檢查 Claude Code 連線
  let claudeConnected = false;
  let claudeAccount = '';
  let claudeSubscription = '';
  let claudeModels = '';
  let claudeError = '';
  try {
    const status = await checkClaudeStatus(config.defaultCwd);
    if (status.success) {
      claudeConnected = true;
      claudeAccount = status.accountInfo?.email ?? '';
      claudeSubscription = status.accountInfo?.subscriptionType ?? '';
      if (status.models?.length) {
        claudeModels = status.models.map((m) => m.displayName).join(', ');
      }
    } else {
      claudeError = status.error ?? '未知錯誤';
    }
  } catch (err) {
    claudeError = err instanceof Error ? err.message : String(err);
  }

  const permName = ({ default: '預設模式', plan: '計畫模式', acceptEdits: '允許編輯', bypassPermissions: '略過權限' } as Record<string, string>)[config.defaultPermissionMode] ?? config.defaultPermissionMode;
  const botTag = client.user?.tag ?? 'Unknown';

  // 啟動畫面
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
  const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
  const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

  const bannerLines = [
    '',
    bold('  Discord Claude Bot') + dim('  v0.1.0'),
    dim('  ─────────────────────────────────'),
    '',
    `  ${green('●')} Discord     ${botTag}`,
    `  ${claudeConnected ? green('●') : red('●')} Claude Code ${claudeConnected ? '已連線' : '連線失敗'}`,
  ];
  if (claudeError) bannerLines.push(`               ${dim(claudeError)}`);
  bannerLines.push('');
  if (claudeAccount) bannerLines.push(`  ${dim('帳號')}    ${claudeAccount}`);
  if (claudeSubscription) bannerLines.push(`  ${dim('方案')}    ${claudeSubscription}`);
  if (claudeModels) bannerLines.push(`  ${dim('模型')}    ${claudeModels}`);
  if (claudeAccount || claudeSubscription || claudeModels) bannerLines.push('');
  bannerLines.push(`  ${dim('預設模型')}  ${config.defaultModel}`);
  bannerLines.push(`  ${dim('權限模式')}  ${permName}`);
  if (config.defaultCwd) bannerLines.push(`  ${dim('工作目錄')}  ${config.defaultCwd}`);
  bannerLines.push(`  ${dim('允許專案')}  ${config.projects.length} 個 (${config.projects.map((p) => p.name).join(', ')})`);
  bannerLines.push('');
  bannerLines.push(`  ${cyan('就緒，等待指令。')}`);
  bannerLines.push('');
  printBanner(bannerLines);

  // 優雅關閉
  function shutdown() {
    log.info('收到關閉訊號，正在關閉...');

    // 中斷所有活躍 Session
    const activeSessions = store.getAllActiveSessions();
    for (const [threadId, session] of activeSessions) {
      session.abortController.abort();
      store.clearSession(threadId);
    }

    destroyDiscordClient(client);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  log.fatal({ err: error }, '啟動失敗');
  process.exit(1);
});
