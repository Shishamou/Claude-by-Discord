import { query, type Query, type Options, type SDKMessage, type SDKUserMessage, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { EffortLevel, FileAttachment, PermissionMode } from '../types.js';

/** {@link startQuery} 的選項參數 */
export interface ClaudeBridgeOptions {
  cwd: string;
  model: string;
  /** 推理深度，透過 CLAUDE_CODE_EFFORT_LEVEL 環境變數傳遞給 CLI（null/未設定時不注入） */
  effort?: EffortLevel | null;
  permissionMode: PermissionMode;
  abortController: AbortController;
  canUseTool?: CanUseTool;
  onMessage: (message: SDKMessage) => void;
  onError: (error: Error) => void;
  onComplete: () => void;
  resume?: string;
  attachments?: FileAttachment[];
}

/**
 * 將文字 + 檔案附件組合為 SDK 所需的 AsyncIterable prompt 格式
 * @param text - 使用者提示文字
 * @param attachments - 圖片或 PDF 附件陣列
 * @returns SDK 可消費的 AsyncIterable<SDKUserMessage>
 */
function buildRichPrompt(text: string, attachments: FileAttachment[]): AsyncIterable<SDKUserMessage> {
  const contentBlocks: Array<Record<string, unknown>> = [];

  if (text) {
    contentBlocks.push({ type: 'text', text });
  }

  for (const att of attachments) {
    if (att.type === 'image') {
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.base64,
        },
      });
    } else if (att.type === 'document') {
      contentBlocks.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: att.mediaType,
          data: att.base64,
        },
        title: att.filename,
      });
    }
    // text type 已經嵌入 prompt 文字中，不需要 content block
  }

  const userMessage = {
    type: 'user' as const,
    message: {
      role: 'user' as const,
      content: contentBlocks,
    },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;

  async function* generate() {
    yield userMessage;
  }

  return generate();
}

/**
 * 啟動 Claude Code SDK 查詢，在背景非同步迭代訊息串流
 * @param prompt - 使用者提示文字
 * @param opts - 查詢選項（工作目錄、模型、回呼等）
 * @returns Query 實例與 session ID（init 前可能為 null）
 */
export async function startQuery(
  prompt: string,
  opts: ClaudeBridgeOptions,
): Promise<{ queryInstance: Query; sessionId: string | null }> {
  const options: Options = {
    cwd: opts.cwd,
    model: opts.model,
    permissionMode: opts.permissionMode === 'bypassPermissions' ? 'bypassPermissions' : opts.permissionMode,
    allowDangerouslySkipPermissions: opts.permissionMode === 'bypassPermissions' ? true : undefined,
    abortController: opts.abortController,
    canUseTool: opts.canUseTool,
    includePartialMessages: true,
    settingSources: ['project', 'local'],
    resume: opts.resume,
    // Effort 透過環境變數傳遞給 CLI 子行程，未設定時不覆寫 Options.env
    ...(opts.effort
      ? { env: { ...process.env, CLAUDE_CODE_EFFORT_LEVEL: opts.effort } }
      : {}),
  };

  // 若有檔案附件（圖片/PDF），使用 AsyncIterable<SDKUserMessage> 格式
  const hasRichAttachments = opts.attachments && opts.attachments.length > 0;
  const promptParam: string | AsyncIterable<SDKUserMessage> = hasRichAttachments
    ? buildRichPrompt(prompt, opts.attachments!)
    : prompt;

  const queryInstance = query({ prompt: promptParam, options });

  let sessionId: string | null = null;

  // 非同步迭代串流（不阻塞呼叫方）
  (async () => {
    try {
      for await (const message of queryInstance) {
        // 擷取 session_id
        if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
          sessionId = message.session_id;
        }

        opts.onMessage(message);
      }
      opts.onComplete();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        opts.onComplete();
      } else {
        opts.onError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  })();

  // 等一小段時間讓 init 訊息抵達
  await new Promise((resolve) => setTimeout(resolve, 500));

  return { queryInstance, sessionId };
}

/**
 * 中斷進行中的 Claude Code 查詢
 * @param queryInstance - 要中斷的 Query 實例
 */
export async function interruptQuery(queryInstance: Query): Promise<void> {
  try {
    await queryInstance.interrupt();
  } catch {
    // 可能已經結束
  }
}
