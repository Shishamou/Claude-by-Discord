import { type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
import type { AskState, PendingApproval } from '../types.js';
import type { StateStore } from '../effects/state-store.js';
import { buildAskQuestionStepEmbed, buildAskCompletedEmbed } from '../modules/embeds.js';
import { buildQuestionButtons, buildAnswerModal } from '../effects/discord-sender.js';
import { logger } from '../effects/logger.js';

const log = logger.child({ module: 'AskHandler' });

/** AskUserQuestion 處理器的依賴注入介面 */
export interface AskHandlerDeps {
  store: StateStore;
}

/**
 * 前進到下一題或完成所有問題
 * discord-client.ts 已預先 defer，統一使用 editReply
 */
async function advanceOrFinalize(
  threadId: string,
  pending: PendingApproval,
  interaction: ButtonInteraction | ModalSubmitInteraction,
  store: StateStore,
): Promise<void> {
  const askState = pending.askState!;
  const nextIdx = askState.currentQuestionIndex + 1;

  if (nextIdx >= askState.totalQuestions) {
    const toolInput = pending.toolInput as Record<string, unknown>;
    const summaryEmbed = buildAskCompletedEmbed(askState);

    await interaction.editReply({ embeds: [summaryEmbed], components: [] });

    store.resolvePendingApproval(threadId, {
      behavior: 'allow',
      updatedInput: { ...toolInput, answers: askState.collectedAnswers },
    });

    log.info({ threadId, answers: askState.collectedAnswers }, '所有問題已回答');
  } else {
    askState.currentQuestionIndex = nextIdx;
    askState.selectedOptions = new Set();
    askState.isMultiSelect = askState.questions[nextIdx].multiSelect;

    const nextEmbed = buildAskQuestionStepEmbed(askState);
    const nextButtons = buildQuestionButtons(threadId, askState);

    await interaction.editReply({ embeds: [nextEmbed], components: nextButtons });

    log.info({ threadId, nextQuestion: nextIdx }, '前進到下一題');
  }
}

/**
 * 處理選項按鈕點擊（單選直接前進，多選 toggle 選中狀態）
 * discord-client.ts 已預先 deferUpdate，直接 editReply
 */
export async function handleAskOptionClick(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  optIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.editReply({ content: '⚠️ 此請求已過期' });
    return;
  }

  const { askState } = pending;

  if (qIdx !== askState.currentQuestionIndex) {
    await interaction.editReply({ content: '⚠️ 此選項已過期' });
    return;
  }

  if (askState.isMultiSelect) {
    if (askState.selectedOptions.has(optIdx)) {
      askState.selectedOptions.delete(optIdx);
    } else {
      askState.selectedOptions.add(optIdx);
    }

    const embed = buildAskQuestionStepEmbed(askState);
    const buttons = buildQuestionButtons(threadId, askState);
    await interaction.editReply({ embeds: [embed], components: buttons });
  } else {
    const selectedLabel = askState.questions[qIdx].options[optIdx]?.label || `選項 ${optIdx + 1}`;
    askState.collectedAnswers[String(qIdx)] = selectedLabel;
    await advanceOrFinalize(threadId, pending, interaction, deps.store);
  }
}

/**
 * 處理多選確認按鈕
 * discord-client.ts 已預先 deferUpdate，直接 editReply
 */
export async function handleAskSubmit(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.editReply({ content: '⚠️ 此請求已過期' });
    return;
  }

  const { askState } = pending;

  if (qIdx !== askState.currentQuestionIndex) {
    await interaction.editReply({ content: '⚠️ 此選項已過期' });
    return;
  }

  if (askState.selectedOptions.size === 0) {
    await interaction.editReply({ content: '⚠️ 請至少選擇一個選項' });
    return;
  }

  const q = askState.questions[qIdx];
  const selectedLabels = Array.from(askState.selectedOptions)
    .sort((a, b) => a - b)
    .map((i) => q.options[i]?.label || `選項 ${i + 1}`);
  askState.collectedAnswers[String(qIdx)] = selectedLabels.join(', ');

  await advanceOrFinalize(threadId, pending, interaction, deps.store);
}

/**
 * 處理「其他」按鈕點擊，顯示 Modal
 * showModal 必須是 first response，discord-client.ts 不會預先 defer 此類按鈕
 */
export async function handleAskOther(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ 此請求已過期', flags: [64] });
    return;
  }

  if (qIdx !== pending.askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ 此選項已過期', flags: [64] });
    return;
  }

  const questionText = pending.askState.questions[qIdx]?.question || '請輸入你的回答';
  const modal = buildAnswerModal(threadId, questionText, qIdx);
  await interaction.showModal(modal);
}

/**
 * 處理 Modal 提交
 * discord-client.ts 已預先 deferReply，直接 editReply
 */
export async function handleAskModalSubmit(
  interaction: ModalSubmitInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.editReply({ content: '⚠️ 此請求已過期' });
    return;
  }

  if (qIdx !== pending.askState.currentQuestionIndex) {
    await interaction.editReply({ content: '⚠️ 此選項已過期' });
    return;
  }

  const answerText = interaction.fields.getTextInputValue('answer_text');
  pending.askState.collectedAnswers[String(qIdx)] = answerText;

  await advanceOrFinalize(threadId, pending, interaction, deps.store);
}
