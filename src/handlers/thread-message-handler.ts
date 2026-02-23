import type { Message, Client } from 'discord.js';
import type { BotConfig, SessionState, FileAttachment } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { logger } from '../effects/logger.js';
import { isUserAuthorized } from '../modules/permissions.js';

const log = logger.child({ module: 'Thread' });
import { buildFollowUpEmbed } from '../modules/embeds.js';
import { sendInThread } from '../effects/discord-sender.js';

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SUPPORTED_TEXT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.html', '.css', '.scss', '.less', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.csv',
  '.txt', '.md', '.mdx', '.rst', '.log',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.prisma',
  '.env', '.gitignore', '.dockerignore', '.editorconfig',
  '.dockerfile',
];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_TEXT_FILE_SIZE = 1 * 1024 * 1024; // 1MB（文字檔較小限制）

/** Thread 訊息處理器的依賴注入介面 */
export interface ThreadMessageHandlerDeps {
  config: BotConfig;
  store: StateStore;
  client: Client;
  startClaudeQuery: (session: SessionState, threadId: string) => Promise<void>;
}

/**
 * 依據 MIME 類型與檔名判斷附件屬於圖片、文件或文字檔
 *
 * @param contentType - 附件的 MIME 類型（可能為 null）
 * @param filename - 附件的檔案名稱
 * @returns 附件類型字串，若不支援則回傳 null
 */
export function classifyAttachment(contentType: string | null, filename: string): 'image' | 'document' | 'text' | null {
  if (contentType && SUPPORTED_IMAGE_TYPES.includes(contentType)) return 'image';
  if (contentType === 'application/pdf') return 'document';

  // 用副檔名判斷文字檔
  const ext = filename.lastIndexOf('.') >= 0 ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  if (SUPPORTED_TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (contentType?.startsWith('text/')) return 'text';

  return null;
}

/**
 * 從 Discord 訊息中下載檔案附件
 */
export async function downloadAttachments(message: Message): Promise<FileAttachment[]> {
  const files: FileAttachment[] = [];

  for (const [, attachment] of message.attachments) {
    const fileType = classifyAttachment(attachment.contentType, attachment.name);
    if (!fileType) continue;

    // 文字檔有較小的大小限制
    const sizeLimit = fileType === 'text' ? MAX_TEXT_FILE_SIZE : MAX_FILE_SIZE;
    if (attachment.size > sizeLimit) continue;

    try {
      const response = await fetch(attachment.url);
      const buffer = Buffer.from(await response.arrayBuffer());

      const fileAttachment: FileAttachment = {
        type: fileType,
        base64: buffer.toString('base64'),
        mediaType: attachment.contentType || 'application/octet-stream',
        filename: attachment.name,
      };

      // 文字檔額外保存純文字內容
      if (fileType === 'text') {
        fileAttachment.textContent = buffer.toString('utf-8');
      }

      files.push(fileAttachment);
    } catch (error) {
      log.error({ err: error, filename: attachment.name }, '下載檔案失敗');
    }
  }

  return files;
}

/**
 * 建立 Thread 訊息處理器，監聽使用者在 Thread 中的續問並啟動 resume 查詢
 *
 * @param deps - Thread 訊息處理器所需的依賴
 * @returns 處理 Discord 訊息事件的非同步函式
 */
export function createThreadMessageHandler(deps: ThreadMessageHandlerDeps) {
  return async function handleThreadMessage(message: Message): Promise<void> {
    // 忽略 Bot 自己的訊息
    if (message.author.bot) return;

    // 只處理 Thread 中的訊息
    if (!message.channel.isThread()) return;

    const threadId = message.channel.id;

    // 確認此 Thread 有對應的 Session
    const { store } = deps;
    const session = store.getSession(threadId);
    if (!session) return;

    // 只在 waiting_input 狀態接受續問
    if (session.status !== 'waiting_input') return;

    // 檢查使用者授權
    if (!isUserAuthorized(message.author.id, deps.config.allowedUserIds)) return;

    // 取得續問文字與檔案
    const followUpText = message.content.trim();
    const fileAttachments = await downloadAttachments(message);

    // 必須有文字或檔案
    if (!followUpText && fileAttachments.length === 0) return;

    // 驗證有 sessionId 可供 resume
    if (!session.sessionId) {
      await message.reply('⚠️ 無法恢復對話：缺少 Session ID');
      return;
    }

    // 建立新的 AbortController
    const newAbortController = new AbortController();

    // 組合 prompt 文字（文字檔內容會嵌入 prompt）
    const textFileContents = fileAttachments
      .filter((f) => f.type === 'text' && f.textContent)
      .map((f) => `--- ${f.filename} ---\n${f.textContent}`)
      .join('\n\n');

    const promptParts = [followUpText, textFileContents].filter(Boolean);
    const promptText = promptParts.join('\n\n') || '（請查看附件）';

    // 非文字檔（圖片 + PDF）需要作為 content block 傳送
    const richAttachments = fileAttachments.filter((f) => f.type !== 'text');

    // 更新 Session 狀態
    store.updateSession(threadId, {
      status: 'running',
      promptText,
      abortController: newAbortController,
      pendingApproval: null,
      attachments: richAttachments.length > 0 ? richAttachments : undefined,
    });

    // 記錄使用者訊息到 transcript
    const updatedSession = store.getSession(threadId);
    if (updatedSession?.transcript) {
      const attachmentSummary = fileAttachments.length > 0
        ? `\n[📎 ${fileAttachments.map((f) => f.filename).join(', ')}]`
        : '';
      updatedSession.transcript.push({
        timestamp: new Date(),
        type: 'user',
        content: `${followUpText || ''}${attachmentSummary}`.slice(0, 2000),
      });
    }

    // 發送續問確認 Embed
    const embed = buildFollowUpEmbed(
      followUpText || '（查看附件）',
      fileAttachments.length,
      fileAttachments.map((f) => f.filename),
    );
    await sendInThread(message.channel, embed);

    // 啟動 resume 查詢
    if (!updatedSession) return;

    deps.startClaudeQuery(updatedSession, threadId).catch(async (error) => {
      log.error({ err: error, threadId }, '恢復查詢錯誤');
      store.updateSession(threadId, { status: 'error' });
    });
  };
}
