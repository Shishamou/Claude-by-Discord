import pino from 'pino';

/** 全域 pino logger 實例 */
export const logger = pino({
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
});

/**
 * 原樣輸出多行文字到 stdout（啟動畫面用，不帶時間戳與等級）
 * @param lines - 要輸出的文字行
 */
export function printBanner(lines: string[]): void {
  for (const line of lines) {
    process.stdout.write(line + '\n');
  }
}
