import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { SignalService } from "@main/services/SignalService";
import type { AmazonJpImageService } from "@main/services/scraper/AmazonJpImageService";
import type { AggregationService } from "@main/services/scraper/aggregation";
import type { DownloadManager } from "@main/services/scraper/DownloadManager";
import type { FileOrganizer, OrganizePlan } from "@main/services/scraper/FileOrganizer";
import { FileScraper } from "@main/services/scraper/FileScraper";
import type { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import type { TranslateService } from "@main/services/scraper/TranslateService";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { describe, expect, it, vi } from "vitest";
import { TestConfigManager } from "./helpers";

const makeAggregationResult = (data: CrawlerData, coverSource?: Website) => ({
  data,
  sources: coverSource ? { cover_url: coverSource } : {},
  stats: {
    totalSites: 1,
    successCount: 1,
    failedCount: 0,
    siteResults: [],
    totalElapsedMs: 1,
  },
});

const baseCrawlerData: CrawlerData = {
  title: "Amazon Test",
  number: "ABC-123",
  actors: ["Actor A"],
  genres: ["Genre A"],
  sample_images: [],
  website: Website.JAVDB,
  cover_url: "https://javdb.com/cover.jpg",
};

const plan: OrganizePlan = {
  outputDir: "/output/ABC-123",
  targetVideoPath: "/output/ABC-123/ABC-123.mp4",
  nfoPath: "/output/ABC-123/ABC-123.nfo",
};

describe("FileScraper Amazon cover enhance", () => {
  it("does not call Amazon enhancement when config is disabled", async () => {
    const config = configurationSchema.parse(defaultConfiguration);
    const enhance = vi.fn().mockResolvedValue({ upgraded: false, reason: "skip: disabled" });

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(makeAggregationResult(baseCrawlerData, Website.JAVDB)),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue(baseCrawlerData),
      } as unknown as TranslateService,
      amazonJpImageService: {
        enhance,
      } as unknown as AmazonJpImageService,
      nfoGenerator: {
        writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(enhance).not.toHaveBeenCalled();
  });

  it("does not call Amazon enhancement when cover is missing", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        amazonJpCoverEnhance: true,
      },
    });
    const enhance = vi.fn().mockResolvedValue({ upgraded: false, reason: "skip: no current cover" });

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi
          .fn()
          .mockResolvedValue(makeAggregationResult({ ...baseCrawlerData, cover_url: undefined }, Website.JAVDB)),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue({ ...baseCrawlerData, cover_url: undefined }),
      } as unknown as TranslateService,
      amazonJpImageService: {
        enhance,
      } as unknown as AmazonJpImageService,
      nfoGenerator: {
        writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(enhance).not.toHaveBeenCalled();
  });

  it("does not call Amazon enhancement for DMM cover source", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        amazonJpCoverEnhance: true,
      },
    });
    const enhance = vi.fn().mockResolvedValue({ upgraded: false, reason: "skip: DMM cover source" });

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(makeAggregationResult(baseCrawlerData, Website.DMM)),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue(baseCrawlerData),
      } as unknown as TranslateService,
      amazonJpImageService: {
        enhance,
      } as unknown as AmazonJpImageService,
      nfoGenerator: {
        writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(enhance).not.toHaveBeenCalled();
  });

  it("does not call Amazon enhancement for AWS DMM covers", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        amazonJpCoverEnhance: true,
      },
    });
    const enhance = vi.fn().mockResolvedValue({ upgraded: false, reason: "skip: AWS DMM cover" });

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi
          .fn()
          .mockResolvedValue(
            makeAggregationResult(
              { ...baseCrawlerData, cover_url: "https://awsimgsrc.dmm.co.jp/cover.jpg" },
              Website.JAVBUS,
            ),
          ),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockResolvedValue(baseCrawlerData),
      } as unknown as TranslateService,
      amazonJpImageService: {
        enhance,
      } as unknown as AmazonJpImageService,
      nfoGenerator: {
        writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(enhance).not.toHaveBeenCalled();
  });

  it("upgrades non-DMM cover before translation and download", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        amazonJpCoverEnhance: true,
      },
    });
    const translateCrawlerData = vi.fn().mockImplementation(async (data: CrawlerData) => data);
    const upgradedUrl = "https://m.media-amazon.com/images/I/81upgrade._AC_SL1500_.jpg";

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(makeAggregationResult(baseCrawlerData, Website.JAVDB)),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData,
      } as unknown as TranslateService,
      amazonJpImageService: {
        enhance: vi
          .fn()
          .mockResolvedValue({ upgraded: true, cover_url: upgradedUrl, reason: "已升级为Amazon商品封面" }),
      } as unknown as AmazonJpImageService,
      nfoGenerator: {
        writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll: vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] }),
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(translateCrawlerData).toHaveBeenCalledWith(
      expect.objectContaining({
        cover_url: upgradedUrl,
        website: Website.JAVDB,
      }),
      expect.any(Object),
    );
  });

  it("does not mutate non-cover fields when enhancement succeeds", async () => {
    const config = configurationSchema.parse({
      ...defaultConfiguration,
      download: {
        ...defaultConfiguration.download,
        amazonJpCoverEnhance: true,
      },
    });
    const downloadAll = vi.fn().mockResolvedValue({ downloaded: [], sceneImages: [] });
    const upgradedUrl = "https://m.media-amazon.com/images/I/81upgrade2._AC_SL1500_.jpg";

    const scraper = new FileScraper({
      configManager: new TestConfigManager(config),
      aggregationService: {
        aggregate: vi.fn().mockResolvedValue(
          makeAggregationResult(
            {
              ...baseCrawlerData,
              poster_url: "https://javdb.com/poster.jpg",
              website: Website.JAVBUS,
            },
            Website.JAVBUS,
          ),
        ),
      } as unknown as AggregationService,
      translateService: {
        translateCrawlerData: vi.fn().mockImplementation(async (data: CrawlerData) => data),
      } as unknown as TranslateService,
      amazonJpImageService: {
        enhance: vi
          .fn()
          .mockResolvedValue({ upgraded: true, cover_url: upgradedUrl, reason: "已升级为Amazon商品封面" }),
      } as unknown as AmazonJpImageService,
      nfoGenerator: {
        writeNfo: vi.fn().mockResolvedValue(plan.nfoPath),
      } as unknown as NfoGenerator,
      downloadManager: {
        downloadAll,
      } as unknown as DownloadManager,
      fileOrganizer: {
        plan: vi.fn().mockReturnValue(plan),
        ensureOutputReady: vi.fn().mockResolvedValue(undefined),
        organizeVideo: vi.fn().mockResolvedValue(plan.targetVideoPath),
        cleanupUnwantedFiles: vi.fn().mockResolvedValue(undefined),
      } as unknown as FileOrganizer,
      signalService: new SignalService(null),
    });

    await scraper.scrapeFile("/tmp/ABC-123.mp4", { fileIndex: 1, totalFiles: 1 });

    expect(downloadAll).toHaveBeenCalledWith(
      plan.outputDir,
      expect.objectContaining({
        cover_url: upgradedUrl,
        poster_url: "https://javdb.com/poster.jpg",
        website: Website.JAVBUS,
      }),
      expect.any(Object),
      undefined,
      expect.any(Object),
    );
  });
});
