import { MessageFlags, type ButtonInteraction, type ModalSubmitInteraction } from 'discord.js';
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
    // 所有問題已回答 → resolve
    const toolInput = pending.toolInput as Record<string, unknown>;
    const summaryEmbed = buildAskCompletedEmbed(askState);

    if (interaction.isButton()) {
      await interaction.update({ embeds: [summaryEmbed], components: [] });
    } else {
      // Modal 提交：回覆 modal，再編輯原訊息
      const lastAnswer = askState.collectedAnswers[String(askState.currentQuestionIndex)] || '';
      await interaction.reply({ content: `✅ 已回答：**${lastAnswer}**`, flags: [MessageFlags.Ephemeral] });
      try {
        const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId!);
        if (channel && 'messages' in channel) {
          const msg = await channel.messages.fetch(pending.messageId);
          await msg.edit({ embeds: [summaryEmbed], components: [] });
        }
      } catch (e) {
        log.warn({ threadId, error: e }, '無法更新原始訊息');
      }
    }

    store.resolvePendingApproval(threadId, {
      behavior: 'allow',
      updatedInput: { ...toolInput, answers: askState.collectedAnswers },
    });

    log.info({ threadId, answers: askState.collectedAnswers }, '所有問題已回答');
  } else {
    // 前進到下一題
    askState.currentQuestionIndex = nextIdx;
    askState.selectedOptions = new Set();
    askState.isMultiSelect = askState.questions[nextIdx].multiSelect;

    const nextEmbed = buildAskQuestionStepEmbed(askState);
    const nextButtons = buildQuestionButtons(threadId, askState);

    if (interaction.isButton()) {
      await interaction.update({ embeds: [nextEmbed], components: nextButtons });
    } else {
      // Modal 提交
      const lastAnswer = askState.collectedAnswers[String(nextIdx - 1)] || '';
      await interaction.reply({ content: `✅ 已回答：**${lastAnswer}**`, flags: [MessageFlags.Ephemeral] });
      try {
        const channel = interaction.channel ?? await interaction.client.channels.fetch(interaction.channelId!);
        if (channel && 'messages' in channel) {
          const msg = await channel.messages.fetch(pending.messageId);
          await msg.edit({ embeds: [nextEmbed], components: nextButtons });
        }
      } catch (e) {
        log.warn({ threadId, error: e }, '無法更新原始訊息');
      }
    }

    log.info({ threadId, nextQuestion: nextIdx }, '前進到下一題');
  }
}

/**
 * 處理選項按鈕點擊（單選直接前進，多選 toggle 選中狀態）
 *
 * @param interaction - Discord 按鈕互動事件
 * @param threadId - 對應的 Thread ID
 * @param qIdx - 當前問題索引
 * @param optIdx - 被點擊的選項索引
 * @param deps - AskHandler 依賴
 * @returns 無回傳值
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
    await interaction.reply({ content: '⚠️ 此請求已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const { askState } = pending;

  if (qIdx !== askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ 此選項已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (askState.isMultiSelect) {
    // 多選：toggle 選中狀態
    if (askState.selectedOptions.has(optIdx)) {
      askState.selectedOptions.delete(optIdx);
    } else {
      askState.selectedOptions.add(optIdx);
    }

    const embed = buildAskQuestionStepEmbed(askState);
    const buttons = buildQuestionButtons(threadId, askState);
    await interaction.update({ embeds: [embed], components: buttons });
  } else {
    // 單選：記錄答案並前進
    const selectedLabel = askState.questions[qIdx].options[optIdx]?.label || `選項 ${optIdx + 1}`;
    askState.collectedAnswers[String(qIdx)] = selectedLabel;
    await advanceOrFinalize(threadId, pending, interaction, deps.store);
  }
}

/**
 * 處理多選確認按鈕，將已選選項記錄為答案並前進至下一題
 *
 * @param interaction - Discord 按鈕互動事件
 * @param threadId - 對應的 Thread ID
 * @param qIdx - 當前問題索引
 * @param deps - AskHandler 依賴
 * @returns 無回傳值
 */
export async function handleAskSubmit(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ 此請求已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const { askState } = pending;

  if (qIdx !== askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ 此選項已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (askState.selectedOptions.size === 0) {
    await interaction.reply({ content: '⚠️ 請至少選擇一個選項', flags: [MessageFlags.Ephemeral] });
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
 * 處理「其他」按鈕點擊，顯示 Modal 讓使用者輸入自訂回答
 *
 * @param interaction - Discord 按鈕互動事件
 * @param threadId - 對應的 Thread ID
 * @param qIdx - 當前問題索引
 * @param deps - AskHandler 依賴
 * @returns 無回傳值
 */
export async function handleAskOther(
  interaction: ButtonInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ 此請求已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (qIdx !== pending.askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ 此選項已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const questionText = pending.askState.questions[qIdx]?.question || '請輸入你的回答';
  const modal = buildAnswerModal(threadId, questionText, qIdx);
  await interaction.showModal(modal);
}

/**
 * 處理 Modal 提交，將使用者自訂文字記錄為答案並前進至下一題
 *
 * @param interaction - Discord Modal 提交互動事件
 * @param threadId - 對應的 Thread ID
 * @param qIdx - 當前問題索引
 * @param deps - AskHandler 依賴
 * @returns 無回傳值
 */
export async function handleAskModalSubmit(
  interaction: ModalSubmitInteraction,
  threadId: string,
  qIdx: number,
  deps: AskHandlerDeps,
): Promise<void> {
  const pending = deps.store.getPendingApproval(threadId);

  if (!pending?.askState) {
    await interaction.reply({ content: '⚠️ 此請求已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  if (qIdx !== pending.askState.currentQuestionIndex) {
    await interaction.reply({ content: '⚠️ 此選項已過期', flags: [MessageFlags.Ephemeral] });
    return;
  }

  const answerText = interaction.fields.getTextInputValue('answer_text');
  pending.askState.collectedAnswers[String(qIdx)] = answerText;

  await advanceOrFinalize(threadId, pending, interaction, deps.store);
}
