import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    mkdir: vi.fn(actual.mkdir),
    writeFile: vi.fn(actual.writeFile),
  };
});

const tempDirs: string[] = [];
const FAILURE_POLICY = {
  threshold: 2,
  windowMs: 60_000,
  cooldownMs: 60_000,
};

const createTempDir = async (): Promise<string> => {
  const dirPath = await fsPromises.mkdtemp(join(tmpdir(), "mdcz-persistent-cooldown-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const waitForDelay = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
};

const waitFor = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await waitForDelay(10);
  }

  throw new Error("Timed out waiting for persistent cooldown store state");
};

describe("PersistentCooldownStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => fsPromises.rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("debounces multiple mutations into a single write", async () => {
    const root = await createTempDir();
    const storePath = join(root, "cooldowns.json");
    const store = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "PersistentCooldownStoreDebounceTest",
      persistDelayMs: 40,
    });

    store.recordFailure("dmm", FAILURE_POLICY);
    await waitForDelay(5);
    store.recordFailure("javdb", FAILURE_POLICY);
    await waitForDelay(5);
    store.open("fc2", 30_000);

    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();

    await waitFor(() => vi.mocked(fsPromises.writeFile).mock.calls.length === 1);

    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fsPromises.readFile(storePath, "utf8"))).toMatchObject({
      dmm: { failureCount: 1, cooldownUntil: null },
      javdb: { failureCount: 1, cooldownUntil: null },
      fc2: { failureCount: 1 },
    });

    await store.flush();
    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(1);
  });

  it("flushes pending mutations immediately", async () => {
    const root = await createTempDir();
    const storePath = join(root, "cooldowns.json");
    const store = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "PersistentCooldownStoreFlushTest",
      persistDelayMs: 60_000,
    });

    store.recordFailure("dmm", FAILURE_POLICY);

    expect(vi.mocked(fsPromises.writeFile)).not.toHaveBeenCalled();

    await store.flush();

    expect(vi.mocked(fsPromises.writeFile)).toHaveBeenCalledTimes(1);

    const reloadedStore = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "PersistentCooldownStoreFlushTestReloaded",
      persistDelayMs: 60_000,
    });

    expect(reloadedStore.get("dmm")).toMatchObject({
      failureCount: 1,
      cooldownUntil: null,
    });
  });

  it("prunes stale non-cooldown entries once their failure window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T00:00:00.000Z"));

    const root = await createTempDir();
    const storePath = join(root, "cooldowns.json");
    const store = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "PersistentCooldownStoreExpiryTest",
      persistDelayMs: 0,
    });

    store.recordFailure("image-host", FAILURE_POLICY);

    expect(store.get("image-host")).toMatchObject({
      failureCount: 1,
      cooldownUntil: null,
    });

    vi.advanceTimersByTime(FAILURE_POLICY.windowMs + 1);

    expect(store.get("image-host")).toBeUndefined();

    await store.flush();

    const reloadedStore = new PersistentCooldownStore({
      filePath: storePath,
      loggerName: "PersistentCooldownStoreExpiryReloaded",
      persistDelayMs: 0,
    });

    expect(reloadedStore.get("image-host")).toBeUndefined();

    vi.useRealTimers();
  });
});
