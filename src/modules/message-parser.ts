import type { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/**
 * 從 SDK assistant 訊息中擷取文字內容
 * @param message - SDK assistant 訊息
 * @returns 擷取出的文字內容
 */
export function extractAssistantText(message: SDKAssistantMessage): string {
  const content = message.message?.content;
  if (!Array.isArray(content)) return '';

  return content
    .filter((block): block is { type: 'text'; text: string } => {
      return typeof block === 'object' && block !== null && 'type' in block && block.type === 'text';
    })
    .map((block) => block.text)
    .join('\n');
}

/**
 * 從 SDK assistant 訊息中擷取工具呼叫
 * @param message - SDK assistant 訊息
 * @returns 工具呼叫陣列（含工具名稱、輸入參數、呼叫 ID）
 */
export function extractToolUse(message: SDKAssistantMessage): Array<{
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
}> {
  const content = message.message?.content;
  if (!Array.isArray(content)) return [];

  return content
    .filter(
      (block): block is {
        type: 'tool_use';
        name: string;
        input: Record<string, unknown>;
        id: string;
      } => {
        return typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_use';
      },
    )
    .map((block) => ({
      toolName: block.name,
      toolInput: block.input,
      toolUseId: block.id,
    }));
}

/**
 * 從 SDK result 訊息中擷取結果摘要
 * @param message - SDK result 訊息
 * @returns 結果摘要（含成功與否、文字、耗時、費用、Token 使用量）
 */
export function extractResult(message: SDKResultMessage): {
  success: boolean;
  text: string;
  durationMs: number;
  costUsd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
} {
  const success = message.subtype === 'success';
  const text = success
    ? (message as { result?: string }).result ?? ''
    : ((message as { errors?: string[] }).errors ?? []).join('\n') || '執行過程中發生錯誤';

  return {
    success,
    text,
    durationMs: message.duration_ms,
    costUsd: message.total_cost_usd,
    usage: {
      input_tokens: message.usage.input_tokens ?? 0,
      output_tokens: message.usage.output_tokens ?? 0,
      cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
