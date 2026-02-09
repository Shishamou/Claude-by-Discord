import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildQuestionButtons,
  buildAnswerModal,
  sendEmbed,
  sendEmbedWithApprovalButtons,
  sendEmbedWithAskButtons,
  updateMessageEmbed,
  editMessageText,
  sendPlainInThread,
  createThread,
  sendInThread,
  sendTextInThread,
  deferReply,
  deferReplyEphemeral,
  editReply,
  sendFollowUp,
} from './discord-sender.js';
import { MessageFlags } from 'discord.js';
import type {
  SendableChannels,
  TextChannel,
  ThreadChannel,
  Message,
  ChatInputCommandInteraction,
  APIEmbed,
} from 'discord.js';
import type { AskState } from '../types.js';

function makeAskState(overrides?: Partial<AskState>): AskState {
  return {
    totalQuestions: 1,
    currentQuestionIndex: 0,
    collectedAnswers: {},
    selectedOptions: new Set(),
    isMultiSelect: false,
    questions: [
      {
        question: '你要選哪個？',
        header: 'Q1',
        options: [
          { label: '選項 A', description: '描述 A' },
          { label: '選項 B', description: '描述 B' },
        ],
        multiSelect: false,
      },
    ],
    ...overrides,
  };
}

describe('buildQuestionButtons', () => {
  it('為每個選項建立按鈕', () => {
    const state = makeAskState();
    const rows = buildQuestionButtons('thread-1', state);

    // 應有一個 ActionRow
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // 第一個 row 應含選項按鈕 + 其他按鈕
    const firstRow = rows[0];
    const components = firstRow.components;
    // 2 個選項 + 1 個「其他」= 3
    expect(components.length).toBe(3);
  });

  it('按鈕 customId 包含 threadId、qIdx、optIdx', () => {
    const state = makeAskState();
    const rows = buildQuestionButtons('t1', state);
    const btn = rows[0].components[0];
    expect(btn.data).toMatchObject({
      custom_id: 'ask:t1:0:0',
    });
  });

  it('選中的選項使用 Success 樣式', () => {
    const state = makeAskState({ selectedOptions: new Set([1]) });
    const rows = buildQuestionButtons('t1', state);
    // 第二個按鈕（index 1）應為 Success 樣式
    expect(rows[0].components[1].data).toMatchObject({
      style: 3, // ButtonStyle.Success = 3
    });
    // 第一個按鈕不選中，應為 Primary
    expect(rows[0].components[0].data).toMatchObject({
      style: 1, // ButtonStyle.Primary = 1
    });
  });

  it('包含「其他」按鈕', () => {
    const state = makeAskState();
    const rows = buildQuestionButtons('t1', state);
    const allComponents = rows.flatMap((r) => r.components);
    const otherBtn = allComponents.find(
      (c) => (c.data as Record<string, unknown>).custom_id === 'ask_other:t1:0',
    );
    expect(otherBtn).toBeDefined();
  });

  it('多選時包含「確認選擇」按鈕', () => {
    const state = makeAskState({ isMultiSelect: true });
    const rows = buildQuestionButtons('t1', state);
    const allComponents = rows.flatMap((r) => r.components);
    const submitBtn = allComponents.find(
      (c) => (c.data as Record<string, unknown>).custom_id === 'ask_submit:t1:0',
    );
    expect(submitBtn).toBeDefined();
  });

  it('單選時不包含「確認選擇」按鈕', () => {
    const state = makeAskState({ isMultiSelect: false });
    const rows = buildQuestionButtons('t1', state);
    const allComponents = rows.flatMap((r) => r.components);
    const submitBtn = allComponents.find(
      (c) => (c.data as Record<string, unknown>).custom_id === 'ask_submit:t1:0',
    );
    expect(submitBtn).toBeUndefined();
  });

  it('超過 4 個選項時換行', () => {
    const manyOptions = Array.from({ length: 6 }, (_, i) => ({
      label: `選項 ${i}`,
      description: `描述 ${i}`,
    }));
    const state = makeAskState({
      questions: [{ question: 'Q', header: 'H', options: manyOptions, multiSelect: false }],
    });
    const rows = buildQuestionButtons('t1', state);
    // 4 個按鈕一行，第二行放剩餘 2 個 + 其他
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('最多回傳 5 行', () => {
    const manyOptions = Array.from({ length: 20 }, (_, i) => ({
      label: `選項 ${i}`,
      description: `描述 ${i}`,
    }));
    const state = makeAskState({
      questions: [{ question: 'Q', header: 'H', options: manyOptions, multiSelect: true }],
    });
    const rows = buildQuestionButtons('t1', state);
    expect(rows.length).toBeLessThanOrEqual(5);
  });

  it('label 超過 80 字元會被截斷', () => {
    const longLabel = 'A'.repeat(100);
    const state = makeAskState({
      questions: [{ question: 'Q', header: 'H', options: [{ label: longLabel, description: '' }], multiSelect: false }],
    });
    const rows = buildQuestionButtons('t1', state);
    const btnLabel = (rows[0].components[0].data as Record<string, unknown>).label as string;
    expect(btnLabel.length).toBeLessThanOrEqual(80);
  });
});

describe('buildAnswerModal', () => {
  it('建立含正確 customId 的 Modal', () => {
    const modal = buildAnswerModal('t1', '你想怎麼做？', 2);
    expect(modal.data.custom_id).toBe('ask_modal:t1:2');
  });

  it('標題為「自訂回答」', () => {
    const modal = buildAnswerModal('t1', 'Q');
    expect(modal.data.title).toBe('自訂回答');
  });

  it('包含一個文字輸入元件', () => {
    const modal = buildAnswerModal('t1', 'Q');
    expect(modal.components.length).toBe(1);
  });

  it('預設 qIdx 為 0', () => {
    const modal = buildAnswerModal('t1', 'Q');
    expect(modal.data.custom_id).toBe('ask_modal:t1:0');
  });

  it('問題文字超過 45 字元會截斷', () => {
    const longQuestion = 'A'.repeat(100);
    const modal = buildAnswerModal('t1', longQuestion);
    const row = modal.components[0];
    const input = row.components[0];
    expect((input.data as Record<string, unknown>).label).toHaveLength(45);
  });
});

// ─── Mock ────────────────────────────────────────────

vi.mock('../modules/formatters.js', () => ({
  chunkMessage: vi.fn((text: string) => [text]),
}));

import { chunkMessage } from '../modules/formatters.js';

// ─── Factory helpers ─────────────────────────────────

function makeEmbed(overrides?: Partial<APIEmbed>): APIEmbed {
  return { title: '測試 Embed', description: '內容', ...overrides };
}

function makeChannel() {
  return { send: vi.fn().mockResolvedValue({ id: 'sent-1' }) } as unknown as SendableChannels;
}

function makeMsg() {
  return { edit: vi.fn().mockResolvedValue({ id: 'edited-1' }) } as unknown as Message;
}

function makeThread(archived = false) {
  return {
    archived,
    send: vi.fn().mockResolvedValue({ id: 'thread-msg-1' }),
    setArchived: vi.fn().mockResolvedValue(undefined),
  } as unknown as ThreadChannel;
}

function makeTextChannel() {
  return {
    threads: { create: vi.fn().mockResolvedValue({ id: 'new-thread' }) },
  } as unknown as TextChannel;
}

function makeInteraction() {
  return {
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({ id: 'reply-1' }),
    followUp: vi.fn().mockResolvedValue({ id: 'followup-1' }),
  } as unknown as ChatInputCommandInteraction;
}

// ─── sendEmbed ───────────────────────────────────────

describe('sendEmbed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('呼叫 channel.send 帶 embeds', async () => {
    const channel = makeChannel();
    const embed = makeEmbed();
    await sendEmbed(channel, embed);

    expect(channel.send).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('回傳發送後的訊息', async () => {
    const channel = makeChannel();
    const result = await sendEmbed(channel, makeEmbed());

    expect(result).toEqual({ id: 'sent-1' });
  });
});

// ─── sendEmbedWithApprovalButtons ────────────────────

describe('sendEmbedWithApprovalButtons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('發送 embed 與核准拒絕按鈕', async () => {
    const channel = makeChannel();
    const embed = makeEmbed();
    await sendEmbedWithApprovalButtons(channel, embed, 'thread-42');

    expect(channel.send).toHaveBeenCalledTimes(1);
    const callArg = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.embeds).toEqual([embed]);
    expect(callArg.components).toHaveLength(1);
  });

  it('按鈕 customId 包含 threadId', async () => {
    const channel = makeChannel();
    await sendEmbedWithApprovalButtons(channel, makeEmbed(), 'thread-42');

    const callArg = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const row = callArg.components[0];
    const buttonIds = row.components.map(
      (c: { data: Record<string, unknown> }) => c.data.custom_id,
    );
    expect(buttonIds).toContain('approve:thread-42');
    expect(buttonIds).toContain('deny:thread-42');
  });
});

// ─── sendEmbedWithAskButtons ─────────────────────────

describe('sendEmbedWithAskButtons', () => {
  beforeEach(() => vi.clearAllMocks());

  it('發送 embed 與預建按鈕', async () => {
    const channel = makeChannel();
    const embed = makeEmbed();
    const state = makeAskState();
    const buttons = buildQuestionButtons('t1', state);

    await sendEmbedWithAskButtons(channel, embed, buttons);

    const callArg = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.embeds).toEqual([embed]);
    expect(callArg.components).toBe(buttons);
  });
});

// ─── updateMessageEmbed ──────────────────────────────

describe('updateMessageEmbed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('更新 embed 並清除 components', async () => {
    const msg = makeMsg();
    const embed = makeEmbed();
    await updateMessageEmbed(msg, embed);

    expect(msg.edit).toHaveBeenCalledWith({ embeds: [embed], components: [] });
  });
});

// ─── editMessageText ─────────────────────────────────

describe('editMessageText', () => {
  beforeEach(() => vi.clearAllMocks());

  it('編輯為純文字並清除 embeds 和 components', async () => {
    const msg = makeMsg();
    await editMessageText(msg, '新文字');

    expect(msg.edit).toHaveBeenCalledWith({
      content: '新文字',
      embeds: [],
      components: [],
    });
  });
});

// ─── sendPlainInThread ───────────────────────────────

describe('sendPlainInThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('非封存 Thread 直接發送，不呼叫 setArchived', async () => {
    const thread = makeThread(false);
    await sendPlainInThread(thread, '你好');

    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledWith('你好');
  });

  it('封存 Thread 先解除再發送', async () => {
    const thread = makeThread(true);
    await sendPlainInThread(thread, '你好');

    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).toHaveBeenCalledWith('你好');
  });
});

// ─── createThread ────────────────────────────────────

describe('createThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('在頻道建立公開 Thread', async () => {
    const channel = makeTextChannel();
    await createThread(channel, '測試 Thread');

    expect(channel.threads.create).toHaveBeenCalledWith({
      name: '測試 Thread',
      autoArchiveDuration: 60,
      type: 11, // ChannelType.PublicThread
    });
  });
});

// ─── sendInThread ────────────────────────────────────

describe('sendInThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('發送 embed 到 Thread', async () => {
    const thread = makeThread(false);
    const embed = makeEmbed();
    await sendInThread(thread, embed);

    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledWith({ embeds: [embed] });
  });

  it('封存 Thread 先解除再發送 embed', async () => {
    const thread = makeThread(true);
    const embed = makeEmbed();
    await sendInThread(thread, embed);

    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).toHaveBeenCalledWith({ embeds: [embed] });
  });
});

// ─── sendTextInThread ────────────────────────────────

describe('sendTextInThread', () => {
  beforeEach(() => vi.clearAllMocks());

  it('短文字單則發送', async () => {
    const thread = makeThread(false);
    const result = await sendTextInThread(thread, '短文字');

    expect(chunkMessage).toHaveBeenCalledWith('短文字', 2000);
    expect(thread.send).toHaveBeenCalledTimes(1);
    expect(thread.send).toHaveBeenCalledWith('短文字');
    expect(result).toHaveLength(1);
  });

  it('長文字切分為多則', async () => {
    vi.mocked(chunkMessage).mockReturnValueOnce(['chunk1', 'chunk2']);
    const thread = makeThread(false);
    const result = await sendTextInThread(thread, '很長的文字');

    expect(thread.send).toHaveBeenCalledTimes(2);
    expect(thread.send).toHaveBeenNthCalledWith(1, 'chunk1');
    expect(thread.send).toHaveBeenNthCalledWith(2, 'chunk2');
    expect(result).toHaveLength(2);
  });

  it('封存 Thread 先解除再發送', async () => {
    const thread = makeThread(true);
    await sendTextInThread(thread, '文字');

    expect(thread.setArchived).toHaveBeenCalledWith(false);
    expect(thread.send).toHaveBeenCalled();
  });

  it('回傳所有訊息陣列', async () => {
    vi.mocked(chunkMessage).mockReturnValueOnce(['a', 'b', 'c']);
    const thread = makeThread(false);
    const result = await sendTextInThread(thread, '很長');

    expect(result).toHaveLength(3);
    result.forEach((msg) => expect(msg).toEqual({ id: 'thread-msg-1' }));
  });
});

// ─── Interaction 回應 ────────────────────────────────

describe('deferReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('呼叫 interaction.deferReply', async () => {
    const interaction = makeInteraction();
    await deferReply(interaction);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
  });
});

describe('deferReplyEphemeral', () => {
  beforeEach(() => vi.clearAllMocks());

  it('帶 Ephemeral flags 呼叫 deferReply', async () => {
    const interaction = makeInteraction();
    await deferReplyEphemeral(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({
      flags: [MessageFlags.Ephemeral],
    });
  });
});

describe('editReply', () => {
  beforeEach(() => vi.clearAllMocks());

  it('回傳編輯後的訊息', async () => {
    const interaction = makeInteraction();
    const options = { content: '已完成' };
    const result = await editReply(interaction, options);

    expect(interaction.editReply).toHaveBeenCalledWith(options);
    expect(result).toEqual({ id: 'reply-1' });
  });
});

describe('sendFollowUp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('發送後續追加訊息', async () => {
    const interaction = makeInteraction();
    const options = { content: '追加內容' };
    const result = await sendFollowUp(interaction, options);

    expect(interaction.followUp).toHaveBeenCalledWith(options);
    expect(result).toEqual({ id: 'followup-1' });
  });
});
