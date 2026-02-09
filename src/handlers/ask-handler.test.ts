import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { StateStore } from '../effects/state-store.js';
import type { AskState, PendingApproval, SessionState } from '../types.js';
import {
  handleAskOptionClick,
  handleAskSubmit,
  handleAskOther,
  handleAskModalSubmit,
} from './ask-handler.js';

// Mock dependencies
vi.mock('../effects/discord-sender.js', () => ({
  buildQuestionButtons: vi.fn().mockReturnValue([]),
  buildAnswerModal: vi.fn().mockReturnValue({ data: { custom_id: 'modal' } }),
}));

vi.mock('../modules/embeds.js', () => ({
  buildAskQuestionStepEmbed: vi.fn().mockReturnValue({ title: 'step' }),
  buildAskCompletedEmbed: vi.fn().mockReturnValue({ title: 'completed' }),
}));

function makeSession(threadId: string): SessionState {
  return {
    sessionId: null,
    status: 'awaiting_permission',
    threadId,
    userId: 'u1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test',
    cwd: '/test',
    model: 'model',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
  };
}

function makeAskState(overrides?: Partial<AskState>): AskState {
  return {
    totalQuestions: 2,
    currentQuestionIndex: 0,
    collectedAnswers: {},
    selectedOptions: new Set(),
    isMultiSelect: false,
    questions: [
      {
        question: '第一題？',
        header: 'Q1',
        options: [
          { label: 'A', description: 'desc A' },
          { label: 'B', description: 'desc B' },
        ],
        multiSelect: false,
      },
      {
        question: '第二題？',
        header: 'Q2',
        options: [
          { label: 'X', description: 'desc X' },
          { label: 'Y', description: 'desc Y' },
        ],
        multiSelect: true,
      },
    ],
    ...overrides,
  };
}

function makePendingApproval(askState: AskState, resolve?: (result: unknown) => void): PendingApproval {
  return {
    toolName: 'AskUserQuestion',
    toolInput: { questions: [] },
    messageId: 'msg-1',
    resolve: resolve || vi.fn(),
    createdAt: new Date(),
    askState,
  };
}

function makeButtonInteraction(overrides?: Record<string, unknown>) {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    isButton: () => true,
    ...overrides,
  } as unknown;
}

function makeModalInteraction(answerText = '自訂回答') {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
    isButton: () => false,
    fields: {
      getTextInputValue: vi.fn().mockReturnValue(answerText),
    },
    channel: {
      messages: {
        fetch: vi.fn().mockResolvedValue({
          edit: vi.fn().mockResolvedValue(undefined),
        }),
      },
    },
  } as unknown;
}

describe('handleAskOptionClick', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('無 pending 時回覆過期訊息', async () => {
    const interaction = makeButtonInteraction();
    await handleAskOptionClick(interaction as never, 'thread-1', 0, 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此請求已過期' }),
    );
  });

  it('qIdx 不匹配時回覆過期訊息', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    // 目前在 qIdx 0，傳入 qIdx 1
    await handleAskOptionClick(interaction as never, 't1', 1, 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此選項已過期' }),
    );
  });

  it('單選時記錄答案並前進到下一題', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: false });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskOptionClick(interaction as never, 't1', 0, 1, { store });

    expect(askState.collectedAnswers['0']).toBe('B');
    // 前進到下一題，update 應被呼叫
    expect((interaction as Record<string, unknown>).update).toHaveBeenCalled();
  });

  it('多選時 toggle 選中狀態', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: true });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    // 選中 index 0
    await handleAskOptionClick(interaction as never, 't1', 0, 0, { store });
    expect(askState.selectedOptions.has(0)).toBe(true);

    // 再次點擊取消選中
    await handleAskOptionClick(interaction as never, 't1', 0, 0, { store });
    expect(askState.selectedOptions.has(0)).toBe(false);
  });

  it('單選最後一題時 resolve pending', async () => {
    const resolveResult = vi.fn();
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({
      totalQuestions: 1,
      questions: [makeAskState().questions[0]],
    });
    store.setPendingApproval('t1', makePendingApproval(askState, resolveResult));

    const interaction = makeButtonInteraction();
    await handleAskOptionClick(interaction as never, 't1', 0, 0, { store });

    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'allow' }),
    );
  });
});

describe('handleAskSubmit', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('無 pending 時回覆過期訊息', async () => {
    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此請求已過期' }),
    );
  });

  it('未選擇任何選項時提示', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: true, selectedOptions: new Set() });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 請至少選擇一個選項' }),
    );
  });

  it('多選提交時合併選中的 label', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({
      isMultiSelect: true,
      selectedOptions: new Set([0, 1]),
    });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 0, { store });
    expect(askState.collectedAnswers['0']).toBe('A, B');
  });

  it('qIdx 不匹配時回覆過期', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({ isMultiSelect: true });
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskSubmit(interaction as never, 't1', 5, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此選項已過期' }),
    );
  });
});

describe('handleAskOther', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('無 pending 時回覆過期訊息', async () => {
    const interaction = makeButtonInteraction();
    await handleAskOther(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此請求已過期' }),
    );
  });

  it('qIdx 不匹配時回覆過期', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction();
    await handleAskOther(interaction as never, 't1', 99, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此選項已過期' }),
    );
  });

  it('正常情況顯示 modal', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeButtonInteraction({ showModal: vi.fn().mockResolvedValue(undefined) });
    await handleAskOther(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).showModal).toHaveBeenCalled();
  });
});

describe('handleAskModalSubmit', () => {
  let store: StateStore;

  beforeEach(() => {
    store = new StateStore();
    vi.clearAllMocks();
  });

  it('無 pending 時回覆過期訊息', async () => {
    const interaction = makeModalInteraction();
    await handleAskModalSubmit(interaction as never, 't1', 0, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此請求已過期' }),
    );
  });

  it('qIdx 不匹配時回覆過期', async () => {
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState();
    store.setPendingApproval('t1', makePendingApproval(askState));

    const interaction = makeModalInteraction();
    await handleAskModalSubmit(interaction as never, 't1', 99, { store });
    expect((interaction as Record<string, unknown>).reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: '⚠️ 此選項已過期' }),
    );
  });

  it('記錄自訂回答', async () => {
    const resolveResult = vi.fn();
    store.setSession('t1', makeSession('t1'));
    const askState = makeAskState({
      totalQuestions: 1,
      questions: [makeAskState().questions[0]],
    });
    store.setPendingApproval('t1', makePendingApproval(askState, resolveResult));

    const interaction = makeModalInteraction('我的自訂答案');
    await handleAskModalSubmit(interaction as never, 't1', 0, { store });

    expect(askState.collectedAnswers['0']).toBe('我的自訂答案');
    expect(resolveResult).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'allow' }),
    );
  });
});
