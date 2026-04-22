import { RateLimiter } from "@main/services/network/RateLimiter";
import { describe, expect, it, vi } from "vitest";

const getQueueCount = (limiter: RateLimiter): number => {
  return (limiter as unknown as { queues: Map<string, unknown> }).queues.size;
};

describe("RateLimiter", () => {
  it("evicts idle per-domain queues after the ttl", async () => {
    vi.useFakeTimers();

    const limiter = new RateLimiter(5, 1_000);

    await expect(limiter.schedule("https://images.example.com/poster.jpg", async () => "ok")).resolves.toBe("ok");
    expect(getQueueCount(limiter)).toBe(1);

    vi.advanceTimersByTime(999);
    expect(getQueueCount(limiter)).toBe(1);

    vi.advanceTimersByTime(1);
    expect(getQueueCount(limiter)).toBe(0);

    vi.useRealTimers();
  });
});
