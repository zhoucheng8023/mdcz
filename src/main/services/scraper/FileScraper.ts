import { randomUUID } from "node:crypto";
import type { Configuration } from "@main/services/config";
import { configurationSchema } from "@main/services/config";
import type { ConfigManager } from "@main/services/config/ConfigManager";
import { loggerService } from "@main/services/LoggerService";
import type { SignalService } from "@main/services/SignalService";
import { parseFileInfo } from "@main/utils/number";
import { probeVideoMetadata } from "@main/utils/video";
import { Website } from "@shared/enums";
import type { CrawlerData, FileInfo, ScrapeResult, VideoMeta } from "@shared/types";
import type { AmazonJpImageService } from "./AmazonJpImageService";
import type { AggregationService } from "./aggregation";
import type { DownloadManager } from "./DownloadManager";
import type { FileOrganizer } from "./FileOrganizer";
import type { NfoGenerator } from "./NfoGenerator";
import type { TranslateService } from "./TranslateService";

export interface FileScraperDependencies {
  configManager: ConfigManager;
  aggregationService: AggregationService;
  translateService: TranslateService;
  amazonJpImageService: AmazonJpImageService;
  nfoGenerator: NfoGenerator;
  downloadManager: DownloadManager;
  fileOrganizer: FileOrganizer;
  signalService: SignalService;
}

export interface FileScrapeProgress {
  fileIndex: number;
  totalFiles: number;
}

export class FileScraper {
  private readonly logger = loggerService.getLogger("FileScraper");

  constructor(private readonly deps: FileScraperDependencies) {}

  async scrapeFile(
    filePath: string,
    progress: FileScrapeProgress = { fileIndex: 1, totalFiles: 1 },
    signal?: AbortSignal,
  ): Promise<ScrapeResult> {
    const taskId = randomUUID();
    const fileInfo = parseFileInfo(filePath);

    this.deps.signalService.showLogText(`Starting scrape task ${taskId} for ${fileInfo.fileName}`);
    this.setProgress(progress, 0);

    try {
      const configuration = configurationSchema.parse(await this.deps.configManager.get());

      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: configuration.scrape.enabledSites[0],
        step: "search",
      });

      const aggregationResult = await this.deps.aggregationService.aggregate(fileInfo.number, configuration, signal);

      if (!aggregationResult) {
        this.setProgress(progress, 100);
        await this.handleFailedFileMove(fileInfo, configuration);
        const failedResult: ScrapeResult = {
          fileInfo,
          status: "failed",
          error: "No crawler returned metadata",
        };
        this.deps.signalService.showScrapeResult(failedResult);
        this.deps.signalService.showFailedInfo({ fileInfo, error: "No crawler returned metadata" });
        return failedResult;
      }

      let crawlerData: CrawlerData = aggregationResult.data;
      let videoMeta: VideoMeta | undefined;

      try {
        videoMeta = await probeVideoMetadata(fileInfo.filePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Video probe failed: ${message}`);
      }

      this.setProgress(progress, 30);
      const plan = this.deps.fileOrganizer.plan(fileInfo, crawlerData, configuration);
      await this.deps.fileOrganizer.ensureOutputReady(plan, fileInfo.filePath);

      if (configuration.download.amazonJpCoverEnhance) {
        crawlerData = await this.maybeEnhanceAmazonCover(
          fileInfo.number,
          crawlerData,
          aggregationResult.sources.cover_url,
        );
      }

      const translated = await this.deps.translateService.translateCrawlerData(crawlerData, configuration);
      this.setProgress(progress, 50);

      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: translated.website,
        step: "download",
      });

      const assets = await this.deps.downloadManager.downloadAll(
        plan.outputDir,
        translated,
        configuration,
        aggregationResult.imageAlternatives,
        {
          onSceneProgress: (downloaded, total) => {
            this.deps.signalService.showLogText(`[${fileInfo.number}] Scene images: ${downloaded}/${total}`);
          },
        },
      );
      this.setProgress(progress, 75);

      let savedNfoPath: string | undefined;
      if (configuration.download.downloadNfo) {
        savedNfoPath = await this.deps.nfoGenerator.writeNfo(plan.nfoPath, translated, {
          assets,
          sources: aggregationResult.sources,
          videoMeta,
        });
      }
      this.setProgress(progress, 80);

      this.deps.signalService.showScrapeInfo({
        fileInfo,
        site: translated.website,
        step: "organize",
      });

      const outputVideoPath = await this.deps.fileOrganizer.organizeVideo(fileInfo, plan, configuration);
      await this.deps.fileOrganizer.cleanupUnwantedFiles(assets, plan.nfoPath, configuration);

      this.setProgress(progress, 100);

      const result: ScrapeResult = {
        fileInfo: {
          ...fileInfo,
          filePath: outputVideoPath,
        },
        status: "success",
        crawlerData: translated,
        videoMeta,
        outputPath: plan.outputDir,
        nfoPath: savedNfoPath,
        assets,
        sources: aggregationResult.sources,
      };

      this.deps.signalService.showScrapeResult(result);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scrape failed for ${fileInfo.filePath}: ${message}`);
      this.setProgress(progress, 100);

      try {
        const cfg = configurationSchema.parse(await this.deps.configManager.get());
        await this.handleFailedFileMove(fileInfo, cfg);
      } catch (moveError) {
        const moveMsg = moveError instanceof Error ? moveError.message : String(moveError);
        this.logger.warn(`Failed to move file to failed folder: ${moveMsg}`);
      }

      const failedResult: ScrapeResult = {
        fileInfo,
        status: "failed",
        error: message,
      };
      this.deps.signalService.showScrapeResult(failedResult);
      this.deps.signalService.showFailedInfo({ fileInfo, error: message });
      return failedResult;
    }
  }

  private setProgress(progress: FileScrapeProgress, stepPercent: number): void {
    const normalizedPercent = Math.max(0, Math.min(100, stepPercent));
    const fileIndex = Math.max(1, progress.fileIndex);
    const totalFiles = Math.max(1, progress.totalFiles);
    const globalValue = (fileIndex - 1 + normalizedPercent / 100) / totalFiles;
    const value = Math.max(0, Math.min(100, Math.round(globalValue * 100)));

    this.deps.signalService.setProgress(value, fileIndex, totalFiles);
  }

  private async maybeEnhanceAmazonCover(
    number: string,
    crawlerData: CrawlerData,
    coverSource?: Website,
  ): Promise<CrawlerData> {
    const currentCover = crawlerData.cover_url?.trim();
    if (!currentCover) {
      this.deps.signalService.showLogText(`[${number}] Amazon封面图片增强: skip: no current cover`);
      return crawlerData;
    }

    if (coverSource === Website.DMM) {
      this.deps.signalService.showLogText(`[${number}] Amazon封面图片增强: skip: DMM cover source`);
      return crawlerData;
    }

    if (currentCover.includes("awsimgsrc.dmm.co.jp")) {
      this.deps.signalService.showLogText(`[${number}] Amazon封面图片增强: skip: AWS DMM cover`);
      return crawlerData;
    }

    const amazonCover = await this.deps.amazonJpImageService.enhance(crawlerData, coverSource);
    this.deps.signalService.showLogText(`[${number}] Amazon封面图片增强: ${amazonCover.reason}`);
    if (!amazonCover.upgraded || !amazonCover.cover_url) {
      return crawlerData;
    }

    return {
      ...crawlerData,
      cover_url: amazonCover.cover_url,
    };
  }

  private async handleFailedFileMove(fileInfo: FileInfo, config: Configuration): Promise<void> {
    if (!config.behavior.failedFileMove) return;
    try {
      await this.deps.fileOrganizer.moveToFailedFolder(fileInfo, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to move file to failed folder: ${message}`);
    }
  }
}
