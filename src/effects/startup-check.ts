import { query, type AccountInfo, type ModelInfo } from '@anthropic-ai/claude-agent-sdk';

/** 啟動時 Claude Code 連線檢查的結果 */
export interface StartupCheckResult {
  success: boolean;
  accountInfo?: AccountInfo;
  models?: ModelInfo[];
  error?: string;
}

/**
 * 啟動時檢查 Claude Code 連線狀態，建立最小 query 取得帳號資訊後立即關閉
 * @param cwd - 工作目錄，用於初始化 SDK
 * @returns 連線檢查結果，包含帳號資訊與可用模型
 */
export async function checkClaudeStatus(cwd: string): Promise<StartupCheckResult> {
  const abortController = new AbortController();
  const q = query({
    prompt: 'hi',
    options: {
      cwd,
      permissionMode: 'plan',
      abortController,
      maxTurns: 1,
    },
  });

  try {
    // 開始迭代觸發 init
    const iter = q[Symbol.asyncIterator]();
    const first = await Promise.race([
      iter.next(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ]);

    if (first === null) {
      throw new Error('連線逾時（10 秒）');
    }

    const accountInfo = await q.accountInfo();
    const initResult = await q.initializationResult();

    abortController.abort();
    q.close();

    return {
      success: true,
      accountInfo,
      models: initResult.models,
    };
  } catch (error) {
    abortController.abort();
    try { q.close(); } catch { /* ignore */ }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
