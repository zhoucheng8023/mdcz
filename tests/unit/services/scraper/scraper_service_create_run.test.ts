import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultConfiguration } from "@main/services/config";
import { DesktopPersistenceService } from "@main/services/persistence";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { createMediaRoot } from "@mdcz/media-store";
import { PersistentCooldownStore } from "@mdcz/runtime/cooldown";
import { CrawlerProvider, FetchGateway } from "@mdcz/runtime/crawler";
import { NetworkClient } from "@mdcz/runtime/network";
import { ActorImageService, FileScraper, ScrapeTargetConflictError } from "@mdcz/runtime/scrape";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockConfigManager } from "../../../helpers/scraper";

const directories: string[] = [];
const persistenceServices: DesktopPersistenceService[] = [];
const scraperServices: ScraperService[] = [];

const createHarness = async () => {
  const directory = await mkdtemp(join(tmpdir(), "mdcz-scraper-create-run-"));
  directories.push(directory);
  const persistence = new DesktopPersistenceService(join(directory, "mdcz.sqlite"), null);
  persistenceServices.push(persistence);
  const networkClient = new NetworkClient();
  const service = new ScraperService(
    new SignalService(null),
    networkClient,
    new CrawlerProvider({ fetchGateway: new FetchGateway(networkClient) }),
    new ActorImageService({ cacheRoot: join(directory, "actors"), networkClient }),
    undefined,
    new PersistentCooldownStore({ filePath: join(directory, "image-host-cooldowns.json") }),
    undefined,
    persistence,
  );
  scraperServices.push(service);
  mockConfigManager({
    ...defaultConfiguration,
    paths: { ...defaultConfiguration.paths, mediaPath: join(directory, "library-a") },
  });
  vi.spyOn(FileScraper.prototype, "scrapeFile").mockResolvedValue({
    fileId: "ABC-001.mp4",
    rootId: "unused",
    relativePath: "ABC-001.mp4",
    fileName: "ABC-001.mp4",
    status: "failed",
    error: "test",
    assets: [],
  });
  return { directory, persistence, service };
};

describe("ScraperService ref-native start", () => {
  afterEach(async () => {
    await Promise.all(scraperServices.splice(0).map(async (service) => await service.shutdown({ timeoutMs: 1_000 })));
    await Promise.all(persistenceServices.splice(0).map(async (service) => await service.close()));
    await Promise.all(
      directories.splice(0).map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
    vi.restoreAllMocks();
  });

  it.each([
    "start",
    "retry",
  ] as const)("rejects all four files before %s when one output already exists", async (operation) => {
    const { directory, persistence, service } = await createHarness();
    const source = join(directory, "source");
    const output = join(directory, "output");
    const metadata = join(output, "metadata");
    await Promise.all([source, metadata].map((path) => mkdir(path, { recursive: true })));
    const state = await persistence.getState();
    const sourceRoot = await state.repositories.mediaRoots.ensurePath(source);
    const outputRoot = await state.repositories.mediaRoots.ensurePath(output);
    const names = ["XYZ-111", "ABF-981", "XYZ-222", "XYZ-333"];
    const refs = names.map((number) => ({ rootId: sourceRoot.id, relativePath: `${number}.mp4` }));
    const contents = new Map<string, string>();
    for (const number of names)
      for (const suffix of [".mp4", ".nfo", ".zh.srt", "-poster.jpg"])
        contents.set(join(source, `${number}${suffix}`), `source ${number}${suffix}`);
    const targetRelativePath = "JAV_output/Actor A/ABF-981/ABF-981.mp4";
    const target = join(output, targetRelativePath);
    contents.set(target, "existing video");
    contents.set(join(dirname(target), "ABF-981.zh.srt"), "existing subtitle");
    for (const suffix of [".nfo", ".strm", "-poster.jpg"])
      contents.set(join(metadata, `Actor A/ABF-981/ABF-981${suffix}`), `existing ${suffix}`);
    for (const [file, content] of contents) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    mockConfigManager({
      ...defaultConfiguration,
      paths: { ...defaultConfiguration.paths, mediaPath: join(directory, "unrelated"), metadataPath: metadata },
      behavior: { ...defaultConfiguration.behavior, failedFileMove: true },
    });
    const libraryEntry = await state.repositories.library.upsertEntry({
      rootId: outputRoot.id,
      rootRelativePath: targetRelativePath,
      number: "ABF-981",
      title: "Existing title",
    });
    const repository = state.repositories.scrapeRuns;
    const startInput = {
      mode: "selection" as const,
      refs,
      outputRootId: outputRoot.id,
      outputRelativeDirectory: "JAV_output",
    };
    let retryRunId: string | undefined;
    if (operation === "retry") {
      const run = await repository.create({
        rootId: sourceRoot.id,
        outputRootId: outputRoot.id,
        outputRelativeDirectory: "JAV_output",
        executionMode: "batch",
        items: refs.map((ref, ordinal) => ({ ...ref, ordinal })),
      });
      for (const item of run.items) {
        const attempt = repository.admitAttempt(item.id);
        repository.commitOutcome({ attemptId: attempt.id, outcome: "failed", error: "previous failure" });
      }
      await repository.finalize({ runId: run.id, disposition: "failed" });
      retryRunId = run.id;
    }
    const beforeRetry = retryRunId ? await repository.get(retryRunId) : null;
    const create = vi.spyOn(repository, "create");
    const retry = vi.spyOn(repository, "retry");
    const launch = retryRunId ? service.retry(retryRunId) : service.start(startInput);
    await expect(launch).rejects.toBeInstanceOf(ScrapeTargetConflictError);
    await expect(launch).rejects.toMatchObject({
      conflicts: [{ number: "ABF-981", sourcePath: join(source, "ABF-981.mp4"), targetPath: target }],
    });
    await service.waitForIdle();
    expect(FileScraper.prototype.scrapeFile).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toBeNull();
    if (retryRunId) expect(await repository.get(retryRunId)).toEqual(beforeRetry);
    expect(await state.repositories.library.getEntryById(libraryEntry.id)).toEqual(libraryEntry);
    expect(state.repositories.publicationJournal.listUnfinished()).toEqual([]);
    for (const [file, content] of contents) expect(await readFile(file, "utf8")).toBe(content);
    await expect(stat(join(output, defaultConfiguration.paths.failedOutputFolder))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("derives the run root from selected refs, not from config.paths.mediaPath", async () => {
    const { directory, persistence, service } = await createHarness();
    const scanRootPath = join(directory, "scan-b");
    await mkdir(scanRootPath, { recursive: true });
    const state = await persistence.getState();
    const scanRoot = await state.repositories.mediaRoots.ensurePath(scanRootPath);
    const result = await service.start({
      mode: "selection",
      refs: [{ rootId: scanRoot.id, relativePath: "ABC-001.mp4" }],
      outputRootId: scanRoot.id,
    });
    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.rootId).toBe(scanRoot.id);
    expect(run.items).toEqual([expect.objectContaining({ rootId: scanRoot.id, relativePath: "ABC-001.mp4" })]);
  });

  it("persists refs from distinct registered roots in one run", async () => {
    const { directory, persistence, service } = await createHarness();
    const state = await persistence.getState();
    const first = await state.repositories.mediaRoots.upsert(
      createMediaRoot({ id: "root-a", displayName: "A", hostPath: join(directory, "a") }),
    );
    const second = await state.repositories.mediaRoots.upsert(
      createMediaRoot({ id: "root-b", displayName: "B", hostPath: join(directory, "b") }),
    );
    const result = await service.start({
      mode: "selection",
      refs: [
        { rootId: first.id, relativePath: "one.mp4" },
        { rootId: second.id, relativePath: "two.mp4" },
      ],
      outputRootId: first.id,
    });
    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.rootId).toBe(first.id);
    expect(run.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rootId: first.id, relativePath: "one.mp4" }),
        expect.objectContaining({ rootId: second.id, relativePath: "two.mp4" }),
      ]),
    );
  });

  it("uses a caller-supplied outputRootId instead of the configured desktop output root", async () => {
    const { directory, persistence, service } = await createHarness();
    const scanRootPath = join(directory, "scan-b");
    const outputRootPath = join(directory, "output-c");
    await mkdir(scanRootPath, { recursive: true });
    await mkdir(outputRootPath, { recursive: true });
    const state = await persistence.getState();
    const scanRoot = await state.repositories.mediaRoots.ensurePath(scanRootPath);
    const outputRoot = await state.repositories.mediaRoots.ensurePath(outputRootPath);
    const result = await service.start({
      mode: "selection",
      refs: [{ rootId: scanRoot.id, relativePath: "ABC-001.mp4" }],
      outputRootId: outputRoot.id,
    });
    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.requestedOutputRootId).toBe(outputRoot.id);
    expect(run.rootId).toBe(scanRoot.id);
  });

  it("stores the nested output offset when the requested directory is inside an existing root", async () => {
    const { directory, persistence, service } = await createHarness();
    const scanRootPath = join(directory, "library");
    const outputRootPath = join(scanRootPath, "JAV_output");
    await mkdir(outputRootPath, { recursive: true });
    const state = await persistence.getState();
    const scanRoot = await state.repositories.mediaRoots.ensurePath(scanRootPath);
    const outputRoot = await state.repositories.mediaRoots.ensurePath(outputRootPath);
    expect(outputRoot.id).toBe(scanRoot.id);
    const result = await service.start({
      mode: "selection",
      refs: [{ rootId: scanRoot.id, relativePath: "ABC-001.mp4" }],
      outputRootId: outputRoot.id,
      outputRelativeDirectory: "JAV_output",
    });
    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.requestedOutputRootId).toBe(scanRoot.id);
    expect(run.requestedOutputRelativeDirectory).toBe("JAV_output");
  });

  it.each([
    undefined,
    "https://javdb.com/v/abc123",
  ])("uses the source root and forwards a selected manual URL (%s)", async (manualUrl) => {
    const { directory, persistence, service } = await createHarness();
    const sourcePath = join(directory, "picked");
    const metadataPath = join(directory, "metadata");
    await Promise.all([mkdir(sourcePath, { recursive: true }), mkdir(metadataPath, { recursive: true })]);
    mockConfigManager({
      ...defaultConfiguration,
      paths: {
        ...defaultConfiguration.paths,
        mediaPath: join(directory, "unrelated-global-output"),
        metadataPath,
      },
    });
    const state = await persistence.getState();
    const sourceRoot = await state.repositories.mediaRoots.ensurePath(sourcePath);

    await writeFile(join(sourcePath, "ABC-001.mp4"), "video");
    await writeFile(join(sourcePath, "ABC-001.nfo"), "existing nfo");

    const result = await service.start({
      mode: "single",
      ref: { rootId: sourceRoot.id, relativePath: "ABC-001.mp4" },
      manualUrl,
    });
    await service.waitForIdle();

    const run = await state.repositories.scrapeRuns.get(result.taskId);
    expect(run.requestedOutputRootId).toBe(sourceRoot.id);
    expect(run.requestedOutputRelativeDirectory).toBeNull();
    const options = vi.mocked(FileScraper.prototype.scrapeFile).mock.calls.at(-1)?.[3];
    expect(run.items[0]?.manualUrl).toBe(manualUrl ?? null);
    expect(options?.manualScrape?.detailUrl).toBe(manualUrl);
    expect(options?.roots).toEqual([expect.objectContaining({ id: sourceRoot.id, hostPath: sourcePath })]);
    await expect(state.repositories.mediaRoots.list()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ hostPath: metadataPath })]),
    );
  });

  it("includes a separate metadata root for batch publication planning", async () => {
    const { directory, persistence, service } = await createHarness();
    const sourcePath = join(directory, "source");
    const outputPath = join(directory, "output");
    const metadataPath = join(directory, "metadata");
    await Promise.all(
      [sourcePath, outputPath, metadataPath].map(async (target) => await mkdir(target, { recursive: true })),
    );
    mockConfigManager({
      ...defaultConfiguration,
      paths: { ...defaultConfiguration.paths, mediaPath: outputPath, metadataPath },
    });
    const state = await persistence.getState();
    const sourceRoot = await state.repositories.mediaRoots.ensurePath(sourcePath);
    const outputRoot = await state.repositories.mediaRoots.ensurePath(outputPath);

    await service.start({
      mode: "selection",
      refs: [{ rootId: sourceRoot.id, relativePath: "ABC-001.mp4" }],
      outputRootId: outputRoot.id,
    });
    await service.waitForIdle();

    const options = vi.mocked(FileScraper.prototype.scrapeFile).mock.calls.at(-1)?.[3];
    expect(options?.roots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sourceRoot.id, hostPath: sourcePath }),
        expect.objectContaining({ id: outputRoot.id, hostPath: outputPath }),
        expect.objectContaining({ hostPath: metadataPath }),
      ]),
    );
  });

  it("rejects a native directory pick that contains multiple media files", async () => {
    const { directory, service } = await createHarness();
    const folder = join(directory, "picked");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "one.mp4"), "video");
    await writeFile(join(folder, "two.mp4"), "video");
    await expect(service.startFromNativePath(folder)).rejects.toMatchObject({ code: "MULTIPLE_FILES" });
  });
});
