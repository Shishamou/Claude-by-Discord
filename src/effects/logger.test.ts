import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, printBanner } from './logger.js';

describe('logger', () => {
  it('應具備 pino logger 的基本方法', () => {
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.child).toBe('function');
  });
});

describe('printBanner', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('每行呼叫 stdout.write', () => {
    printBanner(['line1', 'line2', 'line3']);
    expect(writeSpy).toHaveBeenCalledTimes(3);
  });

  it('每行結尾加換行符', () => {
    printBanner(['line1', 'line2', 'line3']);
    expect(writeSpy).toHaveBeenNthCalledWith(1, 'line1\n');
    expect(writeSpy).toHaveBeenNthCalledWith(2, 'line2\n');
    expect(writeSpy).toHaveBeenNthCalledWith(3, 'line3\n');
  });

  it('空陣列不呼叫 write', () => {
    printBanner([]);
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
