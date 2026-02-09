import { describe, it, expect } from 'vitest';
import {
  buildToolUseEmbed,
  buildPermissionRequestEmbed,
  buildProgressEmbed,
  buildStreamingTextEmbed,
  buildResultEmbed,
  buildErrorEmbed,
  buildStatusEmbed,
  buildSessionStartEmbed,
  buildStopConfirmEmbed,
  buildStopPreviewEmbed,
  buildNotificationEmbed,
  buildFollowUpEmbed,
  buildWaitingInputEmbed,
  buildMultiStatusEmbed,
  buildGlobalStatusEmbed,
  buildRetryEmbed,
  buildAskUserQuestionEmbed,
  buildAskQuestionStepEmbed,
  buildAskCompletedEmbed,
  buildOrphanCleanupEmbed,
} from './embeds.js';
import { COLORS } from '../types.js';
import type { SessionState, TokenUsage, AskState } from '../types.js';
import type { GlobalUsageStats } from '../effects/usage-store.js';

function makeSession(overrides?: Partial<SessionState>): SessionState {
  return {
    sessionId: null,
    status: 'running',
    threadId: 't1',
    userId: 'u1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    promptText: 'test prompt',
    cwd: '/test',
    model: 'claude-sonnet-4-5-20250929',
    toolCount: 0,
    tools: {},
    pendingApproval: null,
    abortController: new AbortController(),
    transcript: [],
    ...overrides,
  };
}

describe('buildToolUseEmbed', () => {
  it('包含工具名稱和 emoji', () => {
    const embed = buildToolUseEmbed('Read', { file_path: '/test/file.ts' }, '/test');
    expect(embed.author?.name).toContain('Read');
    expect(embed.author?.name).toContain('📖');
  });

  it('未知工具用預設 emoji', () => {
    const embed = buildToolUseEmbed('CustomTool', { key: 'val' }, '/test');
    expect(embed.author?.name).toContain('🔧');
  });

  it('有 meta 時顯示 footer', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test', {
      model: 'opus',
      permissionMode: 'default',
      sessionId: 'abcdefgh12345678',
    });
    expect(embed.footer?.text).toContain('opus');
    expect(embed.footer?.text).toContain('abcdefgh');
  });

  it('無 meta 時沒有 footer', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test');
    expect(embed.footer).toBeUndefined();
  });
});

describe('buildPermissionRequestEmbed', () => {
  it('顯示審批提示', () => {
    const embed = buildPermissionRequestEmbed('Bash', { command: 'rm -rf /' }, '/test');
    expect(embed.author?.name).toContain('審批');
    expect(embed.color).toBe(COLORS.Permission);
    expect(embed.fields?.some((f) => f.value.includes('核准'))).toBe(true);
  });
});

describe('buildProgressEmbed', () => {
  it('顯示進度文字與工具數', () => {
    const embed = buildProgressEmbed('處理中...', 5);
    expect(embed.description).toBe('處理中...');
    expect(embed.footer?.text).toContain('5');
  });

  it('超長文字被截斷', () => {
    const longText = 'x'.repeat(5000);
    const embed = buildProgressEmbed(longText, 0);
    expect(embed.description!.length).toBeLessThanOrEqual(4001); // 4000 + 省略號
  });
});

describe('buildStreamingTextEmbed', () => {
  it('顯示回應中狀態', () => {
    const embed = buildStreamingTextEmbed('hello', 3);
    expect(embed.author?.name).toContain('回應中');
    expect(embed.description).toBe('hello');
  });
});

describe('buildResultEmbed', () => {
  it('顯示結果與工具統計', () => {
    const embed = buildResultEmbed('完成', { toolCount: 3, tools: { Read: 2, Write: 1 } });
    expect(embed.title).toContain('完成');
    expect(embed.fields?.some((f) => f.value.includes('Read'))).toBe(true);
  });

  it('空 tools 顯示「無」', () => {
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} });
    expect(embed.fields?.some((f) => f.value === '無')).toBe(true);
  });

  it('有 usage 時顯示 token 消耗', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    expect(embed.fields?.some((f) => f.name.includes('Token'))).toBe(true);
  });

  it('有 cache 時顯示快取欄位', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 10, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    expect(embed.fields?.some((f) => f.name.includes('快取'))).toBe(true);
  });

  it('無 cache 時不顯示快取', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    expect(embed.fields?.some((f) => f.name.includes('快取'))).toBe(false);
  });

  it('有 durationMs 和 costUsd 時顯示', () => {
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, undefined, 5000, 0.05);
    expect(embed.fields?.some((f) => f.name.includes('耗時'))).toBe(true);
    expect(embed.fields?.some((f) => f.name.includes('費用'))).toBe(true);
  });

  it('工具統計按次數排序', () => {
    const embed = buildResultEmbed('ok', {
      toolCount: 6,
      tools: { Write: 1, Read: 3, Bash: 2 },
    });
    const toolField = embed.fields?.find((f) => f.name.includes('工具統計'));
    const lines = toolField!.value.split('\n');
    // Read(3) 應在最前
    expect(lines[0]).toContain('Read');
    expect(lines[1]).toContain('Bash');
    expect(lines[2]).toContain('Write');
  });
});

describe('buildErrorEmbed', () => {
  it('顯示錯誤訊息', () => {
    const embed = buildErrorEmbed('something broke');
    expect(embed.color).toBe(COLORS.Error);
    expect(embed.description).toContain('something broke');
  });

  it('有 context 時顯示上下文', () => {
    const embed = buildErrorEmbed('error', '執行 Bash 時');
    expect(embed.fields).toHaveLength(1);
    expect(embed.fields![0].value).toContain('Bash');
  });

  it('無 context 時沒有 fields', () => {
    const embed = buildErrorEmbed('error');
    expect(embed.fields).toBeUndefined();
  });

  it('超長錯誤被截斷', () => {
    const longError = 'e'.repeat(5000);
    const embed = buildErrorEmbed(longError);
    expect(embed.description!.length).toBeLessThanOrEqual(4001);
  });
});

describe('buildStatusEmbed', () => {
  it('session 為 null 時顯示「無活躍」', () => {
    const embed = buildStatusEmbed(null);
    expect(embed.title).toContain('無活躍');
  });

  it('running session 用 Running 顏色', () => {
    const embed = buildStatusEmbed(makeSession({ status: 'running' }));
    expect(embed.color).toBe(COLORS.Running);
  });

  it('非 running session 用 Info 顏色', () => {
    const embed = buildStatusEmbed(makeSession({ status: 'completed' }));
    expect(embed.color).toBe(COLORS.Info);
  });

  it('顯示工作目錄與模型', () => {
    const embed = buildStatusEmbed(makeSession({ cwd: '/my/project', model: 'opus' }));
    expect(embed.fields?.some((f) => f.value.includes('/my/project'))).toBe(true);
    expect(embed.fields?.some((f) => f.value === 'opus')).toBe(true);
  });

  it('有 sessionUsage 時顯示累計 Token', () => {
    const embed = buildStatusEmbed(makeSession(), {
      usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, total: 1500, costUsd: 0 },
      costUsd: 0.05,
      durationMs: 3000,
    });
    expect(embed.fields?.some((f) => f.name.includes('累計 Token'))).toBe(true);
    expect(embed.fields?.some((f) => f.name.includes('費用'))).toBe(true);
  });

  it('sessionUsage total 為 0 時不顯示 Token', () => {
    const embed = buildStatusEmbed(makeSession(), {
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
      costUsd: 0,
      durationMs: 0,
    });
    expect(embed.fields?.some((f) => f.name.includes('累計 Token'))).toBe(false);
  });
});

describe('buildSessionStartEmbed', () => {
  it('顯示 prompt 和設定', () => {
    const embed = buildSessionStartEmbed('做些什麼', '/cwd', 'model');
    expect(embed.title).toContain('做些什麼');
    expect(embed.fields?.some((f) => f.value.includes('/cwd'))).toBe(true);
  });

  it('超長 prompt 被截斷', () => {
    const embed = buildSessionStartEmbed('a'.repeat(200), '/cwd', 'model');
    expect(embed.title!.length).toBeLessThanOrEqual(101);
  });
});

describe('buildStopPreviewEmbed', () => {
  it('顯示確認中斷', () => {
    const embed = buildStopPreviewEmbed(makeSession({ toolCount: 5, tools: { Read: 3, Write: 2 } }), 10_000);
    expect(embed.title).toContain('中斷');
    expect(embed.fields?.some((f) => f.value.includes('Read'))).toBe(true);
  });

  it('無工具時顯示「尚無」', () => {
    const embed = buildStopPreviewEmbed(makeSession(), 1000);
    expect(embed.fields?.some((f) => f.value === '尚無')).toBe(true);
  });
});

describe('buildStopConfirmEmbed', () => {
  it('顯示中斷結果', () => {
    const embed = buildStopConfirmEmbed({ toolCount: 2, tools: { Bash: 2 } }, 5000);
    expect(embed.author?.name).toContain('已中斷');
    expect(embed.fields?.some((f) => f.value.includes('5s'))).toBe(true);
  });
});

describe('buildMultiStatusEmbed', () => {
  it('顯示多 session 摘要', () => {
    const sessions = new Map([
      ['t1', makeSession({ promptText: '任務一', toolCount: 3 })],
      ['t2', makeSession({ promptText: '任務二', toolCount: 1 })],
    ]);
    const embed = buildMultiStatusEmbed(sessions);
    expect(embed.author?.name).toContain('2');
    expect(embed.description).toContain('任務一');
    expect(embed.description).toContain('任務二');
  });

  it('空 Map 時描述為空', () => {
    const embed = buildMultiStatusEmbed(new Map());
    expect(embed.author?.name).toContain('0');
  });
});

describe('buildGlobalStatusEmbed', () => {
  function makeGlobalStats(overrides?: Partial<GlobalUsageStats>): GlobalUsageStats {
    return {
      bootedAt: new Date(),
      totalSessions: 0,
      completedQueries: 0,
      totalUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, costUsd: 0 },
      totalCostUsd: 0,
      totalDurationMs: 0,
      ...overrides,
    };
  }

  it('顯示運行時間與 session 數', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats({ totalSessions: 3 }), new Map());
    expect(embed.fields?.some((f) => f.name.includes('運行時間'))).toBe(true);
    expect(embed.fields?.some((f) => f.value === '3')).toBe(true);
  });

  it('有 token 用量時顯示累計 Token', () => {
    const embed = buildGlobalStatusEmbed(
      makeGlobalStats({
        totalUsage: { input: 5000, output: 2000, cacheRead: 0, cacheWrite: 0, total: 7000, costUsd: 0 },
        totalCostUsd: 0.5,
      }),
      new Map(),
    );
    expect(embed.fields?.some((f) => f.name.includes('累計 Token'))).toBe(true);
    expect(embed.fields?.some((f) => f.name.includes('累計費用'))).toBe(true);
  });

  it('無 token 用量時不顯示 Token 欄位', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map());
    expect(embed.fields?.some((f) => f.name.includes('累計 Token'))).toBe(false);
  });

  it('有活躍 sessions 時顯示 session 列表', () => {
    const sessions = new Map([
      ['t1', makeSession({ promptText: '任務一' })],
    ]);
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), sessions);
    // 除了計數欄位，還有詳細列表欄位
    expect(embed.fields?.some((f) => f.name.startsWith('活躍 Sessions（'))).toBe(true);
  });

  it('無活躍 sessions 時不顯示 session 列表', () => {
    const embed = buildGlobalStatusEmbed(makeGlobalStats(), new Map());
    // 不應有詳細列表欄位（但計數欄位仍在）
    expect(embed.fields?.some((f) => f.name.startsWith('活躍 Sessions（'))).toBe(false);
  });
});

describe('buildNotificationEmbed', () => {
  it('顯示通知訊息', () => {
    const embed = buildNotificationEmbed('你好');
    expect(embed.description).toBe('你好');
    expect(embed.color).toBe(COLORS.Notification);
  });
});

describe('buildFollowUpEmbed', () => {
  it('顯示續問文字', () => {
    const embed = buildFollowUpEmbed('續問內容');
    expect(embed.description).toContain('續問內容');
  });
});

describe('buildWaitingInputEmbed', () => {
  it('顯示等待輸入', () => {
    const embed = buildWaitingInputEmbed();
    expect(embed.title).toContain('等待');
  });
});

describe('buildRetryEmbed', () => {
  it('顯示重試資訊', () => {
    const embed = buildRetryEmbed('重新做一次');
    expect(embed.description).toContain('重新做一次');
    expect(embed.author?.name).toContain('重試');
  });
});

describe('buildAskUserQuestionEmbed', () => {
  it('顯示問題與選項', () => {
    const embed = buildAskUserQuestionEmbed({
      questions: [{
        header: '選擇',
        question: '你要哪個？',
        options: [{ label: 'A', description: '描述A' }, { label: 'B' }],
      }],
    }, '/cwd');
    expect(embed.title).toContain('選擇');
    expect(embed.description).toContain('你要哪個？');
    expect(embed.description).toContain('A');
    expect(embed.description).toContain('描述A');
  });

  it('空 questions 顯示等待', () => {
    const embed = buildAskUserQuestionEmbed({ questions: [] }, '/cwd');
    expect(embed.title).toContain('等待');
  });

  it('無 questions 欄位顯示等待', () => {
    const embed = buildAskUserQuestionEmbed({}, '/cwd');
    expect(embed.title).toContain('等待');
  });
});

// ─── AskState Factory ────────────────────────────────

function makeAskState(overrides?: Partial<AskState>): AskState {
  return {
    totalQuestions: 2,
    currentQuestionIndex: 0,
    collectedAnswers: {},
    selectedOptions: new Set(),
    isMultiSelect: false,
    questions: [
      { question: '第一題？', header: 'Q1', options: [{ label: 'A', description: '描述A' }, { label: 'B', description: '描述B' }], multiSelect: false },
      { question: '第二題？', header: 'Q2', options: [{ label: 'X', description: '描述X' }], multiSelect: true },
    ],
    ...overrides,
  };
}

// ─── buildAskQuestionStepEmbed ───────────────────────

describe('buildAskQuestionStepEmbed', () => {
  it('單題不顯示進度', () => {
    const state = makeAskState({ totalQuestions: 1, questions: [
      { question: '唯一題？', header: 'Q1', options: [{ label: 'A', description: '' }], multiSelect: false },
    ] });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.author?.name).not.toContain('/');
  });

  it('多題顯示進度', () => {
    const state = makeAskState({ totalQuestions: 3, currentQuestionIndex: 1, questions: [
      { question: '第一題？', header: 'Q1', options: [{ label: 'A', description: '' }], multiSelect: false },
      { question: '第二題？', header: 'Q2', options: [{ label: 'B', description: '' }], multiSelect: false },
      { question: '第三題？', header: 'Q3', options: [{ label: 'C', description: '' }], multiSelect: false },
    ] });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.author?.name).toContain('2/3');
  });

  it('已答問題顯示摘要', () => {
    const state = makeAskState({ currentQuestionIndex: 1, collectedAnswers: { '0': '選A' } });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.description).toContain('選A');
  });

  it('multiSelect 時 footer 提示確認選擇', () => {
    const state = makeAskState({
      isMultiSelect: true,
      questions: [
        { question: '多選題？', header: 'Q1', options: [{ label: 'A', description: '' }], multiSelect: true },
        { question: '第二題？', header: 'Q2', options: [{ label: 'X', description: '' }], multiSelect: false },
      ],
    });
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.footer?.text).toContain('確認選擇');
  });

  it('非 multiSelect 時 footer 提示點擊按鈕', () => {
    const state = makeAskState();
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.footer?.text).toContain('點擊按鈕');
  });

  it('使用 header 作為 title', () => {
    const state = makeAskState();
    const embed = buildAskQuestionStepEmbed(state);
    expect(embed.title).toBe('Q1');
  });
});

// ─── buildAskCompletedEmbed ─────────────────────────

describe('buildAskCompletedEmbed', () => {
  it('顯示所有已答摘要', () => {
    const state = makeAskState({ collectedAnswers: { '0': 'A', '1': 'B' } });
    const embed = buildAskCompletedEmbed(state);
    expect(embed.description).toContain('A');
    expect(embed.description).toContain('B');
  });

  it('使用 WaitingInput 顏色', () => {
    const state = makeAskState({ collectedAnswers: { '0': 'A' } });
    const embed = buildAskCompletedEmbed(state);
    expect(embed.color).toBe(COLORS.WaitingInput);
  });

  it('無 header 時使用問題編號', () => {
    const state = makeAskState({
      collectedAnswers: { '0': 'A' },
      questions: [
        { question: '某問題？', header: '', options: [{ label: 'A', description: '' }], multiSelect: false },
        { question: '第二題？', header: 'Q2', options: [{ label: 'X', description: '' }], multiSelect: false },
      ],
    });
    const embed = buildAskCompletedEmbed(state);
    expect(embed.description).toContain('問題 1');
  });
});

// ─── buildOrphanCleanupEmbed ────────────────────────

describe('buildOrphanCleanupEmbed', () => {
  it('使用 Notification 顏色', () => {
    const embed = buildOrphanCleanupEmbed();
    expect(embed.color).toBe(COLORS.Notification);
  });

  it('描述包含重新使用提示', () => {
    const embed = buildOrphanCleanupEmbed();
    expect(embed.description).toContain('/prompt');
  });
});

// ─── buildResultEmbed - edge cases ──────────────────

describe('buildResultEmbed - edge cases', () => {
  it('空 resultText 時 description 為 undefined', () => {
    const embed = buildResultEmbed('', { toolCount: 0, tools: {} });
    expect(embed.description).toBeUndefined();
  });

  it('僅有 cacheRead 時快取只顯示讀取', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 200, cacheWrite: 0, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    const cacheField = embed.fields?.find((f) => f.name.includes('快取'));
    expect(cacheField?.value).toContain('讀取');
    expect(cacheField?.value).not.toContain('寫入');
  });

  it('僅有 cacheWrite 時快取只顯示寫入', () => {
    const usage: TokenUsage = { input: 100, output: 50, cacheRead: 0, cacheWrite: 50, total: 150, costUsd: 0 };
    const embed = buildResultEmbed('ok', { toolCount: 0, tools: {} }, usage);
    const cacheField = embed.fields?.find((f) => f.name.includes('快取'));
    expect(cacheField?.value).toContain('寫入');
    expect(cacheField?.value).not.toContain('讀取');
  });
});

// ─── buildFollowUpEmbed - edge cases ────────────────

describe('buildFollowUpEmbed - edge cases', () => {
  it('有檔案時顯示檔名', () => {
    const embed = buildFollowUpEmbed('續問', 2, ['a.ts', 'b.py']);
    expect(embed.description).toContain('a.ts');
    expect(embed.description).toContain('b.py');
  });

  it('有 fileCount 但無 filenames 時顯示數量', () => {
    const embed = buildFollowUpEmbed('續問', 3, []);
    expect(embed.description).toContain('3 個檔案');
  });
});

// ─── buildFooterText via buildToolUseEmbed ──────────

describe('buildFooterText via buildToolUseEmbed', () => {
  it('僅有 model 時正確顯示', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test', { model: 'opus' });
    expect(embed.footer?.text).toContain('opus');
    // 不應有多餘的分隔符號
    expect(embed.footer?.text).not.toMatch(/• $/);
    expect(embed.footer?.text).not.toMatch(/^• /);
  });

  it('permissionMode plan 顯示中文', () => {
    const embed = buildToolUseEmbed('Bash', { command: 'ls' }, '/test', { permissionMode: 'plan' });
    expect(embed.footer?.text).toContain('計畫模式');
  });
});
