import { describe, expect, it, vi } from "vitest";
import { TaskScheduler } from "./scheduler";

describe("TaskScheduler", () => {
  it("drains work requested while an empty claim is completing", async () => {
    let releaseEmptyClaim: (() => void) | undefined;
    let blockFirstEmptyClaim = true;
    let taskReady = false;
    const completed: string[] = [];
    const scheduler = new TaskScheduler({
      claimNext: async () => {
        if (!taskReady && blockFirstEmptyClaim) {
          blockFirstEmptyClaim = false;
          await new Promise<void>((resolve) => {
            releaseEmptyClaim = resolve;
          });
          return null;
        }
        if (!taskReady) return null;
        taskReady = false;
        return { id: "queued-during-drain" };
      },
      runExecution: async (task) => {
        completed.push(task.id);
      },
    });

    scheduler.drain();
    await Promise.resolve();
    taskReady = true;
    scheduler.drain();
    releaseEmptyClaim?.();
    await scheduler.waitForIdle();

    expect(completed).toEqual(["queued-during-drain"]);
  });

  it("stops draining and reports a claim infrastructure failure without retrying", async () => {
    const failure = new Error("database unavailable");
    const claimNext = vi.fn().mockRejectedValue(failure);
    const onDrainError = vi.fn();
    const scheduler = new TaskScheduler({
      claimNext,
      runExecution: vi.fn(),
      onDrainError,
    });

    scheduler.drain();
    await scheduler.waitForIdle();
    scheduler.drain();
    await scheduler.waitForIdle();

    expect(claimNext).toHaveBeenCalledTimes(1);
    expect(onDrainError).toHaveBeenCalledWith(failure);
  });

  it("rejects drain when claim fails and no onDrainError is provided", async () => {
    const failure = new Error("database unavailable");
    const claimNext = vi.fn().mockRejectedValue(failure);
    const scheduler = new TaskScheduler({
      claimNext,
      runExecution: vi.fn(),
    });

    scheduler.drain();
    await expect(scheduler.waitForIdle()).rejects.toBe(failure);
    scheduler.drain();
    await expect(scheduler.waitForIdle()).resolves.toBeUndefined();
    expect(claimNext).toHaveBeenCalledTimes(1);
  });
});
