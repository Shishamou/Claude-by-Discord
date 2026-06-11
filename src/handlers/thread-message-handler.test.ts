import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../effects/logger.js', () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));
vi.mock('../modules/embeds.js', () => ({
  buildFollowUpEmbed: vi.fn().mockReturnValue({ title: 'follow-up' }),
}));
vi.mock('../effects/discord-sender.js', () => ({
  sendInThread: vi.fn().mockResolvedValue({ id: 'msg-1' }),
}));
vi.mock('../modules/permissions.js', () => ({
  isUserAuthorized: vi.fn().mockReturnValue(true),
}));

import type { Message, Client } from 'discord.js';
import type { BotConfig, SessionState } from '../types.js';
import type { ThreadMessageHandlerDeps } from './thread-message-handler.js';
import { StateStore } from '../effects/state-store.js';
import { classifyAttachment, createThreadMessageHandler } from './thread-message-handler.js';
import { buildFollowUpEmbed } from '../modules/embeds.js';
import { sendInThread } from '../effects/discord-sender.js';
import { isUserAuthorized } from '../modules/permissions.js';

describe('classifyAttachment', () => {
  // 圖片類型
  it('image/jpeg 回傳 image', () => {
    expect(classifyAttachment('image/jpeg', 'photo.jpg')).toBe('image');
  });

  it('image/png 回傳 image', () => {
    expect(classifyAttachment('image/png', 'screenshot.png')).toBe('image');
  });

  it('image/gif 回傳 image', () => {
    expect(classifyAttachment('image/gif', 'anim.gif')).toBe('image');
  });

  it('image/webp 回傳 image', () => {
    expect(classifyAttachment('image/webp', 'pic.webp')).toBe('image');
  });

  it('不支援的圖片格式回傳 null', () => {
    expect(classifyAttachment('image/bmp', 'old.bmp')).toBeNull();
  });

  // PDF
  it('application/pdf 回傳 document', () => {
    expect(classifyAttachment('application/pdf', 'doc.pdf')).toBe('document');
  });

  // 文字檔（靠副檔名）
  it('.ts 回傳 text', () => {
    expect(classifyAttachment('application/octet-stream', 'index.ts')).toBe('text');
  });

  it('.py 回傳 text', () => {
    expect(classifyAttachment(null, 'script.py')).toBe('text');
  });

  it('.json 回傳 text', () => {
    expect(classifyAttachment(null, 'config.json')).toBe('text');
  });

  it('.md 回傳 text', () => {
    expect(classifyAttachment(null, 'README.md')).toBe('text');
  });

  it('.sh 回傳 text', () => {
    expect(classifyAttachment(null, 'deploy.sh')).toBe('text');
  });

  it('.env 回傳 text', () => {
    expect(classifyAttachment(null, '.env')).toBe('text');
  });

  it('.dockerfile 回傳 text', () => {
    expect(classifyAttachment(null, 'app.dockerfile')).toBe('text');
  });

  // text/* content type fallback
  it('text/plain 回傳 text', () => {
    expect(classifyAttachment('text/plain', 'unknown.xyz')).toBe('text');
  });

  it('text/csv 回傳 text', () => {
    expect(classifyAttachment('text/csv', 'data.dat')).toBe('text');
  });

  // 不支援的類型
  it('不認識的 content type 和副檔名回傳 null', () => {
    expect(classifyAttachment('application/zip', 'archive.zip')).toBeNull();
  });

  it('null content type 且不認識的副檔名回傳 null', () => {
    expect(classifyAttachment(null, 'binary.exe')).toBeNull();
  });

  it('無副檔名且無 content type 回傳 null', () => {
    expect(classifyAttachment(null, 'Makefile')).toBeNull();
  });

  // 大小寫
  it('副檔名大小寫不敏感', () => {
    expect(classifyAttachment(null, 'Main.TS')).toBe('text');
  });

  // 圖片 contentType 優先於副檔名
  it('image contentType 優先於 .txt 副檔名', () => {
    expect(classifyAttachment('image/png', 'misleading.txt')).toBe('image');
  });

  // PDF contentType 優先於副檔名
  it('pdf contentType 優先於副檔名', () => {
    expect(classifyAttachment('application/pdf', 'file.unknown')).toBe('document');
  });
});

// ─── createThreadMessageHandler ────────────────────

function makeSession(threadId: string, overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: 'sess-abc',
    status: 'waiting_input',
    threadId,
    userId: 'u1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'original prompt',
    cwd: '/test',
    model: 'claude-sonnet',
    effort: null,
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

function makeMessage(overrides?: Record<string, unknown>): Message {
  const defaults = {
    author: { bot: false, id: 'u1' },
    channel: {
      isThread: () => true,
      id: 'thread-1',
    },
    content: '請繼續分析',
    attachments: new Map(),
    reply: vi.fn().mockResolvedValue(undefined),
  };

  const merged = { ...defaults, ...overrides };

  // 深層合併 author 與 channel
  if (overrides?.author && typeof overrides.author === 'object') {
    merged.author = { ...defaults.author, ...(overrides.author as Record<string, unknown>) };
  }
  if (overrides?.channel && typeof overrides.channel === 'object') {
    merged.channel = { ...defaults.channel, ...(overrides.channel as Record<string, unknown>) };
  }

  return merged as unknown as Message;
}

function makeDeps(store: StateStore, overrides?: Partial<ThreadMessageHandlerDeps>): ThreadMessageHandlerDeps {
  return {
    config: {
      discordToken: 'token',
      discordGuildId: 'guild-1',
      allowedUserIds: ['u1'],
      defaultModel: 'claude-sonnet',
      defaultEffort: null,
      defaultPermissionMode: 'default',
      maxMessageLength: 2000,
      streamUpdateIntervalMs: 2000,
      rateLimitWindowMs: 60000,
      rateLimitMaxRequests: 10,
      channels: [{ channelId: 'ch-1', name: 'test', path: '/test' }],
    } as BotConfig,
    store,
    client: {} as unknown as Client,
    startClaudeQuery: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('createThreadMessageHandler', () => {
  let store: StateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isUserAuthorized).mockReturnValue(true);
    vi.unstubAllGlobals();
    store = new StateStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('忽略 Bot 自己的訊息', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ author: { bot: true, id: 'bot-1' } });

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('忽略非 Thread 的訊息', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({
      channel: { isThread: () => false, id: 'ch-1' },
    });

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('無對應 Session 時忽略', async () => {
    // store 中沒有 session
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage();

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('非 waiting_input 狀態時忽略', async () => {
    store.setSession('thread-1', makeSession('thread-1', { status: 'running' }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage();

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('未授權使用者時忽略', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    vi.mocked(isUserAuthorized).mockReturnValue(false);
    const message = makeMessage();

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('無文字且無附件時忽略', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ content: '' });

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('只有空白文字且無附件時忽略', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ content: '   ' });

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('缺少 sessionId 時回覆警告', async () => {
    store.setSession('thread-1', makeSession('thread-1', { sessionId: null }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage();

    await handler(message);

    expect(message.reply).toHaveBeenCalledWith('⚠️ 無法恢復對話：缺少 Session ID');
    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('純文字續問：更新狀態並呼叫 startClaudeQuery', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ content: '下一步呢？' });

    await handler(message);

    // 驗證 store 更新為 running
    const session = store.getSession('thread-1');
    expect(session?.status).toBe('running');
    expect(session?.promptText).toBe('下一步呢？');

    // 驗證 sendInThread 被呼叫
    expect(sendInThread).toHaveBeenCalled();

    // 驗證 buildFollowUpEmbed 被呼叫
    expect(buildFollowUpEmbed).toHaveBeenCalledWith('下一步呢？', 0, []);

    // 驗證 startClaudeQuery 被呼叫
    expect(deps.startClaudeQuery).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1', status: 'running' }),
      'thread-1',
    );
  });

  it('記錄 transcript', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ content: '繼續' });

    await handler(message);

    const session = store.getSession('thread-1');
    expect(session?.transcript).toHaveLength(1);
    expect(session?.transcript[0]).toMatchObject({
      type: 'user',
      content: '繼續',
    });
    expect(session?.transcript[0]?.timestamp).toBeInstanceOf(Date);
  });

  it('下載圖片附件並轉 base64', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const mockResponse = {
      arrayBuffer: () => Promise.resolve(imageData.buffer),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const attachments = new Map([
      ['att-1', { contentType: 'image/png', name: 'screenshot.png', size: 1024, url: 'https://cdn.example.com/screenshot.png' }],
    ]);
    const message = makeMessage({ content: '看這張圖', attachments });

    await handler(message);

    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/screenshot.png');

    // 驗證 startClaudeQuery 被呼叫，且 session 含有圖片附件
    const session = store.getSession('thread-1');
    expect(session?.attachments).toHaveLength(1);
    expect(session?.attachments?.[0]).toMatchObject({
      type: 'image',
      mediaType: 'image/png',
      filename: 'screenshot.png',
    });
    expect(session?.attachments?.[0]?.base64).toBeTruthy();
  });

  it('下載文字附件保存 textContent', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const textData = new TextEncoder().encode('console.log("hello");');
    const mockResponse = {
      arrayBuffer: () => Promise.resolve(textData.buffer),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const attachments = new Map([
      ['att-1', { contentType: 'application/octet-stream', name: 'index.ts', size: 100, url: 'https://cdn.example.com/index.ts' }],
    ]);
    const message = makeMessage({ content: '', attachments });

    await handler(message);

    // 文字檔的內容會嵌入 prompt，不會放在 attachments（那是 rich attachments）
    const session = store.getSession('thread-1');
    // promptText 應包含檔案內容
    expect(session?.promptText).toContain('index.ts');
    expect(session?.promptText).toContain('console.log("hello");');
  });

  it('跳過不支援的附件類型', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const attachments = new Map([
      ['att-1', { contentType: 'application/zip', name: 'archive.zip', size: 1024, url: 'https://cdn.example.com/archive.zip' }],
    ]);
    // 沒有文字，只有不支援的附件 -> 應被忽略，因為 fileAttachments 為空且 content 為空
    const message = makeMessage({ content: '', attachments });

    await handler(message);

    // 不支援的附件被跳過，又沒有文字，所以整個訊息被忽略
    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('跳過超過大小限制的附件', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const attachments = new Map([
      ['att-1', { contentType: 'image/png', name: 'huge.png', size: 21 * 1024 * 1024, url: 'https://cdn.example.com/huge.png' }],
    ]);
    const message = makeMessage({ content: '', attachments });

    await handler(message);

    // 超過 20MB 的圖片被跳過，又沒有文字 -> 忽略
    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('文字檔超過 1MB 限制時跳過', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const attachments = new Map([
      ['att-1', { contentType: 'text/plain', name: 'huge.txt', size: 2 * 1024 * 1024, url: 'https://cdn.example.com/huge.txt' }],
    ]);
    const message = makeMessage({ content: '', attachments });

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('fetch 失敗時跳過該附件', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const attachments = new Map([
      ['att-1', { contentType: 'image/png', name: 'broken.png', size: 1024, url: 'https://cdn.example.com/broken.png' }],
    ]);
    // 沒有文字，附件 fetch 失敗 -> fileAttachments 為空 -> 忽略
    const message = makeMessage({ content: '', attachments });

    await handler(message);

    expect(deps.startClaudeQuery).not.toHaveBeenCalled();
  });

  it('fetch 失敗但有文字時仍繼續', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const attachments = new Map([
      ['att-1', { contentType: 'image/png', name: 'broken.png', size: 1024, url: 'https://cdn.example.com/broken.png' }],
    ]);
    const message = makeMessage({ content: '分析一下', attachments });

    await handler(message);

    // 文字仍在，附件失敗被跳過，應繼續執行
    expect(deps.startClaudeQuery).toHaveBeenCalled();
    const session = store.getSession('thread-1');
    expect(session?.promptText).toBe('分析一下');
  });

  it('文字與檔案同時存在時組合 prompt', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const textData = new TextEncoder().encode('const x = 1;');
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ arrayBuffer: () => Promise.resolve(textData.buffer) })
      .mockResolvedValueOnce({ arrayBuffer: () => Promise.resolve(imageData.buffer) }),
    );

    const attachments = new Map([
      ['att-1', { contentType: 'application/octet-stream', name: 'app.ts', size: 100, url: 'https://cdn.example.com/app.ts' }],
      ['att-2', { contentType: 'image/png', name: 'ui.png', size: 2048, url: 'https://cdn.example.com/ui.png' }],
    ]);
    const message = makeMessage({ content: '請看這些檔案', attachments });

    await handler(message);

    const session = store.getSession('thread-1');
    // prompt 應包含使用者文字 + 文字檔內容
    expect(session?.promptText).toContain('請看這些檔案');
    expect(session?.promptText).toContain('app.ts');
    expect(session?.promptText).toContain('const x = 1;');

    // 圖片應在 attachments（rich attachments）
    expect(session?.attachments).toHaveLength(1);
    expect(session?.attachments?.[0]?.type).toBe('image');

    // buildFollowUpEmbed 應收到完整資訊
    expect(buildFollowUpEmbed).toHaveBeenCalledWith(
      expect.stringContaining('請看這些檔案'),
      2,
      ['app.ts', 'ui.png'],
    );
  });

  it('僅有附件無文字時使用預設 prompt', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData.buffer),
    }));

    const attachments = new Map([
      ['att-1', { contentType: 'image/png', name: 'photo.png', size: 1024, url: 'https://cdn.example.com/photo.png' }],
    ]);
    const message = makeMessage({ content: '', attachments });

    await handler(message);

    const session = store.getSession('thread-1');
    // 無文字且無文字檔內容 -> prompt 應為預設值
    expect(session?.promptText).toBe('（請查看附件）');

    // buildFollowUpEmbed 第一個參數應為 '（查看附件）'
    expect(buildFollowUpEmbed).toHaveBeenCalledWith('（查看附件）', 1, ['photo.png']);
  });

  it('startClaudeQuery 拋錯時更新狀態為 error', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const startClaudeQuery = vi.fn().mockRejectedValue(new Error('Claude 炸了'));
    const deps = makeDeps(store, { startClaudeQuery });
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage();

    await handler(message);

    // startClaudeQuery 的 .catch 是 fire-and-forget，需等微任務結算
    await vi.waitFor(() => {
      const session = store.getSession('thread-1');
      expect(session?.status).toBe('error');
    });
  });

  it('更新 Session 時設定新的 AbortController', async () => {
    const originalController = new AbortController();
    store.setSession('thread-1', makeSession('thread-1', { abortController: originalController }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ content: '繼續' });

    await handler(message);

    const session = store.getSession('thread-1');
    expect(session?.abortController).not.toBe(originalController);
    expect(session?.abortController).toBeInstanceOf(AbortController);
  });

  it('更新 Session 時清除 pendingApproval', async () => {
    store.setSession('thread-1', makeSession('thread-1', {
      pendingApproval: {
        toolName: 'Bash',
        toolInput: { command: 'ls' },
        messageId: 'old-msg',
        resolve: vi.fn(),
        createdAt: new Date(),
      },
    }));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);
    const message = makeMessage({ content: '繼續' });

    await handler(message);

    const session = store.getSession('thread-1');
    expect(session?.pendingApproval).toBeNull();
  });

  it('transcript 記錄包含附件摘要', async () => {
    store.setSession('thread-1', makeSession('thread-1'));
    const deps = makeDeps(store);
    const handler = createThreadMessageHandler(deps);

    const imageData = new Uint8Array([0x89]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData.buffer),
    }));

    const attachments = new Map([
      ['att-1', { contentType: 'image/png', name: 'shot.png', size: 512, url: 'https://cdn.example.com/shot.png' }],
    ]);
    const message = makeMessage({ content: '看圖', attachments });

    await handler(message);

    const session = store.getSession('thread-1');
    expect(session?.transcript).toHaveLength(1);
    expect(session?.transcript[0]?.content).toContain('看圖');
    expect(session?.transcript[0]?.content).toContain('shot.png');
  });
});
