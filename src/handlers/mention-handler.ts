import { ChannelType, ThreadAutoArchiveDuration, type Message, type Client } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';
import { resolveChannelConfig } from '../modules/permissions.js';
import { buildErrorEmbed } from '../modules/embeds.js';
import { sendInThread } from '../effects/discord-sender.js';
import { truncate } from '../modules/formatters.js';
import { downloadAttachments } from './thread-message-handler.js';

const log = logger.child({ module: 'Mention' });

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
 * 當 Bot 在已設定的文字頻道（channels.json）被 @ 標注時，自動建立 Thread 並開始對話。
 * 工作目錄、模型與 Effort 取自頻道設定，未覆寫時 fallback 到全域預設值。
 * 存取控制改由 Discord 頻道權限把關，不再檢查使用者白名單。
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

    // 解析頻道設定，未設定的頻道一律靜默忽略
    const channelConfig = resolveChannelConfig(message.channel.id, null, deps.config.channels);
    if (!channelConfig) return;

    // 去除 @mention 標注後取得純文字
    const prompt = message.content.replace(`<@${botUser.id}>`, '').trim();
    const fileAttachments = await downloadAttachments(message);

    // 需要有文字或附件才能啟動
    if (!prompt && fileAttachments.length === 0) return;

    // 以此訊息建立 Thread（Discord UI 會顯示與訊息的連結）
    const threadName = `Session: ${truncate(prompt || '（附件）', 28)}`;
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
    const userPrompt = [prompt, textFileContents].filter(Boolean).join('\n\n') || '（請查看附件）';

    // 頻道提示詞僅在開新 Thread 首輪對話時前置（續問不重複）
    const promptText = [channelConfig.prompt, userPrompt].filter(Boolean).join('\n\n');

    // 非文字檔（圖片 + PDF）作為 content block 傳送
    const richAttachments = fileAttachments.filter((f) => f.type !== 'text');

    // 模型與 Effort：頻道覆寫優先，未設定時 fallback 到全域預設
    const model = channelConfig.model ?? deps.config.defaultModel;
    const effort = channelConfig.effort ?? deps.config.defaultEffort;

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
      cwd: channelConfig.path,
      model,
      effort,
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

    log.info(
      { threadId: thread.id, userId: message.author.id, prompt: truncate(promptText, 60) },
      '@mention 查詢開始',
    );

    // 啟動查詢（非同步，不 await）— 不發送 Session 開始訊息，直接等 Claude 回應串流
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
