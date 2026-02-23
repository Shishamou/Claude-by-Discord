import { ChannelType, ThreadAutoArchiveDuration, type Message, type Client } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';
import { isUserAuthorized } from '../modules/permissions.js';
import { buildSessionStartEmbed, buildErrorEmbed } from '../modules/embeds.js';
import { sendInThread } from '../effects/discord-sender.js';
import { truncate } from '../modules/formatters.js';
import { downloadAttachments } from './thread-message-handler.js';

const log = logger.child({ module: 'Mention' });

/** @mention 觸發時使用的模型（最便宜的 Haiku） */
const MENTION_MODEL = 'claude-haiku-4-5-20251001';

/** @mention 處理器的依賴注入介面 */
export interface MentionHandlerDeps {
  config: BotConfig;
  store: StateStore;
  client: Client;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
}

/**
 * 建立 @mention 處理器
 *
 * 當 Bot 在文字頻道被 @ 標注時，自動以 Haiku 模型建立 Thread 並開始對話。
 * 僅處理非 Thread 的 GuildText 頻道，並驗證使用者是否在授權名單中。
 */
export function createMentionHandler(deps: MentionHandlerDeps) {
  return async function handleMentionMessage(message: Message): Promise<void> {
    // 忽略 Bot 自己的訊息
    if (message.author.bot) return;

    // 只處理非 Thread 的文字頻道
    if (message.channel.isThread()) return;
    if (message.channel.type !== ChannelType.GuildText) return;

    // 確認 Bot 有被 @ 標注
    const botUser = deps.client.user;
    if (!botUser || !message.mentions.has(botUser)) return;

    // 檢查使用者授權
    if (!isUserAuthorized(message.author.id, deps.config.allowedUserIds)) return;

    // 去除 @mention 標注後取得純文字
    const prompt = message.content.replace(`<@${botUser.id}>`, '').trim();
    const fileAttachments = await downloadAttachments(message);

    // 需要有文字或附件才能啟動
    if (!prompt && fileAttachments.length === 0) return;

    // 以此訊息建立 Thread（Discord UI 會顯示與訊息的連結）
    const threadName = `@mention: ${truncate(prompt || '（附件）', 28)}`;
    let thread: import('discord.js').ThreadChannel;
    try {
      thread = await message.startThread({
        name: threadName,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
      });
    } catch (error) {
      log.error({ err: error, channelId: message.channel.id }, '建立 @mention Thread 失敗');
      return;
    }

    // 組合 prompt（文字檔內容嵌入）
    const textFileContents = fileAttachments
      .filter((f) => f.type === 'text' && f.textContent)
      .map((f) => `--- ${f.filename} ---\n${f.textContent}`)
      .join('\n\n');
    const promptParts = [prompt, textFileContents].filter(Boolean);
    const promptText = promptParts.join('\n\n') || '（請查看附件）';

    // 非文字檔（圖片 + PDF）作為 content block 傳送
    const richAttachments = fileAttachments.filter((f) => f.type !== 'text');

    // 建立 Session
    const abortController = new AbortController();
    const session: SessionState = {
      sessionId: null,
      status: 'running',
      threadId: thread.id,
      userId: message.author.id,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      promptText,
      cwd: deps.config.defaultCwd,
      model: MENTION_MODEL,
      toolCount: 0,
      tools: {},
      pendingApproval: null,
      abortController,
      transcript: [],
      attachments: richAttachments.length > 0 ? richAttachments : undefined,
    };

    deps.store.setSession(thread.id, session);
    session.transcript.push({
      timestamp: new Date(),
      type: 'user',
      content: (prompt || '（附件）').slice(0, 2000),
    });

    // 發送開始 Embed
    const startEmbed = buildSessionStartEmbed(promptText, deps.config.defaultCwd, MENTION_MODEL);
    await sendInThread(thread, startEmbed);

    log.info(
      { threadId: thread.id, userId: message.author.id, prompt: truncate(promptText, 60) },
      '@mention 查詢開始',
    );

    // 啟動查詢（非同步，不 await）
    deps.startClaudeQuery(session, thread.id).catch(async (error) => {
      log.error({ err: error, threadId: thread.id }, '@mention 查詢錯誤');
      try {
        const embed = buildErrorEmbed(error instanceof Error ? error.message : String(error));
        await sendInThread(thread, embed);
        await thread.setArchived(true);
      } catch {
        // Thread 可能已不存在
      }
      deps.store.updateSession(thread.id, { status: 'error' });
    });
  };
}
