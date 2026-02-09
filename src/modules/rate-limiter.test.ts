import { describe, it, expect } from 'vitest';
import { checkRateLimit, recordRequest } from './rate-limiter.js';

describe('checkRateLimit', () => {
  const config = { windowMs: 60_000, maxRequests: 3 };

  it('允許 undefined entry', () => {
    const result = checkRateLimit(undefined, config, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('允許空 timestamps', () => {
    const result = checkRateLimit({ timestamps: [] }, config, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('未達上限時允許', () => {
    const now = 100_000;
    const result = checkRateLimit(
      { timestamps: [now - 10_000, now - 5_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });

  it('達到上限時拒絕', () => {
    const now = 100_000;
    const result = checkRateLimit(
      { timestamps: [now - 30_000, now - 20_000, now - 10_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('過期的 timestamps 不計入', () => {
    const now = 200_000;
    const result = checkRateLimit(
      { timestamps: [100_000, now - 10_000] }, // 100_000 已超過 60s window
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it('retryAfterMs 正確計算', () => {
    const now = 100_000;
    const oldest = now - 30_000;
    const result = checkRateLimit(
      { timestamps: [oldest, now - 20_000, now - 10_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(false);
    // retryAfterMs = windowMs - (now - oldest) = 60000 - 30000 = 30000
    expect(result.retryAfterMs).toBe(30_000);
  });

  it('maxRequests = 1 時單次即達上限', () => {
    const now = 100_000;
    const result = checkRateLimit(
      { timestamps: [now - 1000] },
      { windowMs: 60_000, maxRequests: 1 },
      now,
    );
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('所有 timestamps 都過期時允許', () => {
    const now = 1_000_000;
    const result = checkRateLimit(
      { timestamps: [100, 200, 300] },
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });

  it('剛好在 window 邊界的 timestamp 不計入', () => {
    const now = 160_000;
    // timestamp 100_000, now - t = 60_000, 不 < 60_000，所以過期
    const result = checkRateLimit(
      { timestamps: [100_000] },
      config,
      now,
    );
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(3);
  });
});

describe('recordRequest', () => {
  it('從 undefined 建立新 entry', () => {
    const entry = recordRequest(undefined, 1000, 60_000);
    expect(entry.timestamps).toEqual([1000]);
  });

  it('附加到現有 timestamps', () => {
    const entry = recordRequest({ timestamps: [500] }, 1000, 60_000);
    expect(entry.timestamps).toEqual([500, 1000]);
  });

  it('清除過期的 timestamps', () => {
    const now = 200_000;
    const entry = recordRequest(
      { timestamps: [100_000, now - 10_000] },
      now,
      60_000,
    );
    // 100_000 已過期（200000 - 100000 = 100000 > 60000）
    expect(entry.timestamps).toEqual([now - 10_000, now]);
  });
});
