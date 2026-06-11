import {
  type APIEmbed,
  type SendableChannels,
  type TextChannel,
  type ThreadChannel,
  type Message,
  type ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  ThreadAutoArchiveDuration,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} from 'discord.js';
import type { AskState } from '../types.js';
import { chunkMessage } from '../modules/formatters.js';

/** Discord 訊息最大字元數 */
const MAX_MESSAGE_LENGTH = 2000;

// ─── 基礎發送 ───────────────────────────────────────

/**
 * 發送 Embed 到頻道
 *
 * @param channel - 目標可發送頻道
 * @param embed - 要發送的 Embed 物件
 * @returns 發送後的 Discord 訊息
 */
export async function sendEmbed(
  channel: SendableChannels,
  embed: APIEmbed,
): Promise<Message> {
  return channel.send({ embeds: [embed] });
}

/**
 * 發送 Embed 並附加核准／拒絕按鈕，用於工具權限審批
 *
 * @param channel - 目標頻道或 Thread
 * @param embed - 要發送的 Embed 物件
 * @param threadId - 對應的 Thread ID，用於按鈕 customId 綁定
 * @returns 發送後的 Discord 訊息
 */
export async function sendEmbedWithApprovalButtons(
  channel: SendableChannels | ThreadChannel,
  embed: APIEmbed,
  threadId: string,
): Promise<Message> {
  const approve = new ButtonBuilder()
    .setCustomId(`approve:${threadId}`)
    .setLabel('核准')
    .setStyle(ButtonStyle.Success)
    .setEmoji('✅');

  const deny = new ButtonBuilder()
    .setCustomId(`deny:${threadId}`)
    .setLabel('拒絕')
    .setStyle(ButtonStyle.Danger)
    .setEmoji('❌');

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, deny);

  return channel.send({
    embeds: [embed],
    components: [row],
  });
}

/**
 * 根據 AskState 建構問題選項按鈕，支援多選 toggle 狀態
 *
 * @param threadId - 對應的 Thread ID，用於按鈕 customId 綁定
 * @param askState - 當前問題互動的追蹤狀態
 * @returns 按鈕列陣列（最多 5 列）
 */
export function buildQuestionButtons(
  threadId: string,
  askState: AskState,
): ActionRowBuilder<ButtonBuilder>[] {
  const { currentQuestionIndex, questions, selectedOptions, isMultiSelect } = askState;
  const q = questions[currentQuestionIndex];
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();

  for (let i = 0; i < q.options.length; i++) {
    if (currentRow.components.length >= 4) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    const isSelected = selectedOptions.has(i);
    const btn = new ButtonBuilder()
      .setCustomId(`ask:${threadId}:${currentQuestionIndex}:${i}`)
      .setLabel(q.options[i].label.slice(0, 80))
      .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Primary);
    currentRow.addComponents(btn);
  }

  // 「其他」按鈕
  if (currentRow.components.length >= 5) {
    rows.push(currentRow);
    currentRow = new ActionRowBuilder<ButtonBuilder>();
  }
  const otherBtn = new ButtonBuilder()
    .setCustomId(`ask_other:${threadId}:${currentQuestionIndex}`)
    .setLabel('其他')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('✏️');
  currentRow.addComponents(otherBtn);

  // 多選時加「確認選擇」按鈕
  if (isMultiSelect) {
    if (currentRow.components.length >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
    const submitBtn = new ButtonBuilder()
      .setCustomId(`ask_submit:${threadId}:${currentQuestionIndex}`)
      .setLabel('確認選擇')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');
    currentRow.addComponents(submitBtn);
  }

  rows.push(currentRow);
  return rows.slice(0, 5);
}

/**
 * 發送 Embed 並附加預建按鈕，用於 AskUserQuestion 互動
 *
 * @param channel - 目標頻道或 Thread
 * @param embed - 要發送的 Embed 物件
 * @param buttons - 預先建構的按鈕列陣列
 * @returns 發送後的 Discord 訊息
 */
export async function sendEmbedWithAskButtons(
  channel: SendableChannels | ThreadChannel,
  embed: APIEmbed,
  buttons: ActionRowBuilder<ButtonBuilder>[],
): Promise<Message> {
  return channel.send({
    embeds: [embed],
    components: buttons,
  });
}

/**
 * 建立「其他」自訂回答的 Modal 對話框
 *
 * @param threadId - 對應的 Thread ID，用於 Modal customId 綁定
 * @param questionText - 問題文字，作為輸入欄位的標題
 * @param qIdx - 當前問題索引，預設為 0
 * @returns 建構完成的 Modal 物件
 */
export function buildAnswerModal(threadId: string, questionText: string, qIdx = 0): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`ask_modal:${threadId}:${qIdx}`)
    .setTitle('自訂回答');

  const input = new TextInputBuilder()
    .setCustomId('answer_text')
    .setLabel(questionText.slice(0, 45))
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  modal.addComponents(row);
  return modal;
}

/**
 * 更新訊息的 Embed 並移除所有按鈕
 *
 * @param message - 要更新的 Discord 訊息
 * @param embed - 新的 Embed 物件
 * @returns 更新後的 Discord 訊息
 */
export async function updateMessageEmbed(
  message: Message,
  embed: APIEmbed,
): Promise<Message> {
  return message.edit({ embeds: [embed], components: [] });
}

/**
 * 編輯訊息為純文字，同時清除 Embed 和按鈕
 *
 * @param message - 要編輯的 Discord 訊息
 * @param text - 新的純文字內容
 * @returns 編輯後的 Discord 訊息
 */
export async function editMessageText(
  message: Message,
  text: string,
): Promise<Message> {
  return message.edit({ content: text, embeds: [], components: [] });
}

/**
 * 發送單則純文字到 Thread，不切分，用於串流更新
 *
 * @param thread - 目標 Thread
 * @param text - 要發送的純文字內容
 * @returns 發送後的 Discord 訊息
 */
export async function sendPlainInThread(
  thread: ThreadChannel,
  text: string,
): Promise<Message> {
  if (thread.archived) await thread.setArchived(false);
  return thread.send(text);
}

// ─── Thread ─────────────────────────────────────────

/**
 * 在文字頻道中建立公開 Thread
 *
 * @param channel - 父文字頻道
 * @param name - Thread 名稱
 * @returns 建立的 Thread
 */
export async function createThread(
  channel: TextChannel,
  name: string,
): Promise<ThreadChannel> {
  return channel.threads.create({
    name,
    autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
    type: ChannelType.PublicThread,
  });
}

/**
 * 發送 Embed 到 Thread，若已封存會自動解除
 *
 * @param thread - 目標 Thread
 * @param embed - 要發送的 Embed 物件
 * @returns 發送後的 Discord 訊息
 */
export async function sendInThread(
  thread: ThreadChannel,
  embed: APIEmbed,
): Promise<Message> {
  if (thread.archived) await thread.setArchived(false);
  return thread.send({ embeds: [embed] });
}

/**
 * 發送 Embed 與按鈕列到 Thread，若已封存會自動解除
 *
 * @param thread - 目標 Thread
 * @param embed - 要發送的 Embed 物件
 * @param components - 預先建構的按鈕列陣列
 * @returns 發送後的 Discord 訊息
 */
export async function sendInThreadWithComponents(
  thread: ThreadChannel,
  embed: APIEmbed,
  components: ActionRowBuilder<ButtonBuilder>[],
): Promise<Message> {
  if (thread.archived) await thread.setArchived(false);
  return thread.send({ embeds: [embed], components });
}

/**
 * 發送文字到 Thread，超過長度限制時自動切分為多則訊息
 *
 * @param thread - 目標 Thread
 * @param text - 要發送的文字內容
 * @returns 所有發送後的 Discord 訊息陣列
 */
export async function sendTextInThread(
  thread: ThreadChannel,
  text: string,
): Promise<Message[]> {
  if (thread.archived) await thread.setArchived(false);
  const chunks = chunkMessage(text, MAX_MESSAGE_LENGTH);
  const messages: Message[] = [];
  for (const chunk of chunks) {
    messages.push(await thread.send(chunk));
  }
  return messages;
}

// ─── Interaction 回應 ───────────────────────────────

/**
 * 延遲回應互動，顯示「思考中...」提示
 *
 * @param interaction - Discord 斜線指令互動
 * @returns 無回傳值
 */
export async function deferReply(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();
}

/**
 * 延遲回應互動（ephemeral），僅觸發者自己可見
 *
 * @param interaction - Discord 斜線指令互動
 * @returns 無回傳值
 */
export async function deferReplyEphemeral(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
}

/**
 * 編輯已延遲回應的互動訊息
 *
 * @param interaction - Discord 斜線指令互動
 * @param options - 編輯選項，可包含文字、Embed、按鈕或附件
 * @returns 編輯後的 Discord 訊息
 */
export async function editReply(
  interaction: ChatInputCommandInteraction,
  options: { content?: string; embeds?: APIEmbed[]; components?: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] },
): Promise<Message> {
  return interaction.editReply(options);
}

/**
 * 發送後續追加訊息
 *
 * @param interaction - Discord 斜線指令互動
 * @param options - 發送選項，可包含文字或 Embed
 * @returns 發送後的 Discord 訊息
 */
export async function sendFollowUp(
  interaction: ChatInputCommandInteraction,
  options: { content?: string; embeds?: APIEmbed[] },
): Promise<Message> {
  return interaction.followUp(options);
}
