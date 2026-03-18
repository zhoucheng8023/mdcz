import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@shared/enums";
import type { CrawlerData, FileInfo } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

const config = configurationSchema.parse({
  ...defaultConfiguration,
  download: {
    ...defaultConfiguration.download,
    downloadNfo: false,
  },
});

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample Title",
  number: "ABC-123",
  actors: [],
  genres: [],
  scene_images: [],
  website: Website.DMM,
  ...overrides,
});

const createAggregationResult = (data: CrawlerData) => ({
  data,
  sources: {},
  imageAlternatives: {
    thumb_url: [],
    poster_url: [],
    fanart_url: [],
    scene_images: [],
  },
  stats: {
    totalSites: 1,
    successCount: 1,
    failedCount: 0,
    skippedCount: 0,
    siteResults: [],
    totalElapsedMs: 1,
  },
});

const createPlan = (fileInfo: FileInfo): OrganizePlan => ({
  outputDir: `/output/${fileInfo.number}`,
  targetVideoPath: `/output/${fileInfo.number}/${fileInfo.fileName}${fileInfo.extension}`,
  nfoPath: `/output/${fileInfo.number}/${fileInfo.number}.nfo`,
});

const createScraper = (aggregate: ReturnType<typeof vi.fn>) =>
  new FileScraper({
    configManager: new TestConfigManager(config),
    aggregationService: {
      aggregate,
    } as unknown as AggregationService,
    translateService: {
      translateCrawlerData: vi.fn(async (data: CrawlerData) => data),
    } as unknown as TranslateService,
    nfoGenerator: {
      writeNfo: vi.fn(),
    } as unknown as NfoGenerator,
    downloadManager: {
      downloadAll: vi.fn().mockResolvedValue({
        downloaded: [],
        sceneImages: [],
      }),
    } as unknown as DownloadManager,
    fileOrganizer: {
      plan: vi.fn((fileInfo: FileInfo) => createPlan(fileInfo)),
      ensureOutputReady: vi.fn(async (plan: OrganizePlan) => plan),
      organizeVideo: vi.fn(async (_fileInfo: FileInfo, plan: OrganizePlan) => plan.targetVideoPath),
    } as unknown as FileOrganizer,
    signalService: new SignalService(null),
  });

describe("FileScraper multipart aggregation cache", () => {
  it("reuses one aggregation request for same-number multipart files", async () => {
    const aggregate = vi.fn().mockResolvedValue(createAggregationResult(createCrawlerData({ number: "FC2-123456" })));
    const scraper = createScraper(aggregate);

    const [part1, part2] = await Promise.all([
      scraper.scrapeFile("/tmp/FC2-123456-1.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/FC2-123456-2.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(part1.status).toBe("success");
    expect(part2.status).toBe("success");
    expect(part1.fileInfo.part?.number).toBe(1);
    expect(part2.fileInfo.part?.number).toBe(2);
    expect(part1.fileInfo.filePath).toContain("FC2-123456-1");
    expect(part2.fileInfo.filePath).toContain("FC2-123456-2");
  });

  it("keeps aggregation requests separate for different numbers", async () => {
    const aggregate = vi
      .fn()
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "ABC-123" })))
      .mockResolvedValueOnce(createAggregationResult(createCrawlerData({ number: "XYZ-999" })));
    const scraper = createScraper(aggregate);

    const [first, second] = await Promise.all([
      scraper.scrapeFile("/tmp/ABC-123-1.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/XYZ-999-1.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(first.status).toBe("success");
    expect(second.status).toBe("success");
  });

  it("propagates shared aggregation failures to each multipart result", async () => {
    const aggregate = vi.fn().mockRejectedValue(new Error("aggregate failed"));
    const scraper = createScraper(aggregate);

    const [part1, part2] = await Promise.all([
      scraper.scrapeFile("/tmp/FC2-123456-1.mp4", { fileIndex: 1, totalFiles: 2 }),
      scraper.scrapeFile("/tmp/FC2-123456-2.mp4", { fileIndex: 2, totalFiles: 2 }),
    ]);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(part1).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
    expect(part2).toMatchObject({
      status: "failed",
      error: "aggregate failed",
    });
  });
});
