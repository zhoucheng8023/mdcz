import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData, FileInfo, NamingPreviewItem, NfoLocalState } from "@mdcz/shared/types";
import { noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { findSubtitleSidecars, isGeneratedSidecarVideo, type SubtitleSidecarMatch } from "./media";
import { FileMover } from "./organize/FileMover";
import { NamingEngine } from "./organize/NamingEngine";
import { SidecarResolver } from "./organize/SidecarResolver";
import { ensureParentDirectory, isPathInside, listVideoFiles } from "./utils/filesystem";
import { parseFileInfo } from "./utils/number";

export interface OrganizePlan {
  outputDir: string;
  metadataDir?: string;
  targetVideoPath: string;
  nfoPath: string;
  strmPath?: string;
  subtitleSidecars?: SubtitleSidecarMatch[];
}

export const resolveMetadataOutputDir = (plan: OrganizePlan): string => plan.metadataDir ?? plan.outputDir;

interface ResolveOutputPlanOptions {
  createDirectories?: boolean;
}

export interface OrganizePlanOptions {
  executionMode?: ScrapeExecutionMode;
  outputBaseDirectory?: string;
}

export type ScrapeExecutionMode = "single" | "batch";

export const resolveOrganizeDirectory = (
  sourcePath: string,
  config: Configuration,
  options: OrganizePlanOptions = {},
): { directory: string; useFolderTemplate: boolean } => {
  const sourceDir = resolve(dirname(sourcePath));
  if (options.executionMode === "single" || !config.behavior.successFileMove) {
    return { directory: sourceDir, useFolderTemplate: false };
  }
  if (options.outputBaseDirectory) {
    return { directory: resolve(options.outputBaseDirectory), useFolderTemplate: true };
  }
  const base = resolve(config.paths.mediaPath.trim() || sourceDir, config.paths.successOutputFolder.trim());
  return isPathInside(base, sourceDir) && sourceDir !== base
    ? { directory: sourceDir, useFolderTemplate: false }
    : { directory: base, useFolderTemplate: true };
};

interface ScrapeFileTransitionOptions {
  configuration: Configuration;
  failureRootPath: string;
  sourcePath: string;
  sourceRootPath: string;
}

export class FileOrganizer {
  private readonly logger: RuntimeLogger;

  private readonly sidecarResolver = new SidecarResolver();

  private readonly namingEngine = new NamingEngine();

  private readonly fileMover: FileMover;

  constructor(logger: RuntimeLogger = noopRuntimeLogger) {
    this.logger = logger;
    this.fileMover = new FileMover(this.logger, this.sidecarResolver);
  }

  plan(
    fileInfo: FileInfo,
    data: CrawlerData,
    config: Configuration,
    localState?: NfoLocalState,
    options: OrganizePlanOptions = {},
  ): OrganizePlan {
    const layout = this.namingEngine.buildLayout(fileInfo, data, config, localState);
    const { directory, useFolderTemplate } = resolveOrganizeDirectory(fileInfo.filePath, config, options);
    const outputDir = useFolderTemplate ? join(directory, layout.folderRelativePath) : directory;

    const targetVideoPath = join(outputDir, layout.targetVideoFileName);
    const metadataDir = options.executionMode === "single" ? outputDir : this.resolveMetadataDir(outputDir, config);
    const nfoPath = join(metadataDir, layout.nfoFileName);
    const strmPath = metadataDir === outputDir ? undefined : join(metadataDir, `${parse(targetVideoPath).name}.strm`);

    return {
      outputDir,
      metadataDir,
      targetVideoPath,
      nfoPath,
      strmPath,
    };
  }

  buildNamingPreview(config: Configuration): NamingPreviewItem[] {
    return this.namingEngine.buildPreview(config);
  }

  async resolveOutputPlan(
    plan: OrganizePlan,
    sourceFilePath: string,
    options: ResolveOutputPlanOptions = {},
  ): Promise<OrganizePlan> {
    if (options.createDirectories) {
      await ensureParentDirectory(plan.targetVideoPath);
      await ensureParentDirectory(plan.nfoPath);
      if (plan.strmPath) {
        await ensureParentDirectory(plan.strmPath);
      }
    }

    const outputRoot = dirname(plan.targetVideoPath);
    const sourceDir = resolve(dirname(sourceFilePath));
    const sameDirectoryOutput = sourceDir === resolve(outputRoot);

    if (sameDirectoryOutput) {
      const sourceFileInfo = parseFileInfo(sourceFilePath);
      const videoFiles = await listVideoFiles(sourceDir, false);
      const otherVideos = videoFiles.filter((filePath) => {
        if (resolve(filePath) === resolve(sourceFilePath) || isGeneratedSidecarVideo(filePath)) {
          return false;
        }

        const siblingFileInfo = parseFileInfo(filePath);
        if (sourceFileInfo.number && sourceFileInfo.number === siblingFileInfo.number) {
          return false;
        }

        return true;
      });
      if (otherVideos.length > 0) {
        this.logger.warn(`Cannot organize in place because multiple video files exist in ${sourceDir}`);
        throw new Error("成功后不移动文件时，仅支持源目录内存在单个视频文件");
      }
    }

    return {
      ...plan,
      subtitleSidecars: plan.subtitleSidecars ?? (await findSubtitleSidecars(sourceFilePath)),
    };
  }

  createScrapeFileTransitions(options: ScrapeFileTransitionOptions) {
    return {
      failed: async () => {
        if (!options.configuration.behavior.failedFileMove) return;
        await this.moveToFailedFolder(options.sourcePath, options.failureRootPath, options.configuration);
      },
      succeeded: async () => {
        if (!options.configuration.behavior.successFileMove || !options.configuration.behavior.deleteEmptyFolder)
          return;
        await this.cleanupEmptySourceDirectories(options.sourcePath, options.sourceRootPath);
      },
    };
  }

  async cleanupEmptySourceDirectories(sourcePath: string, sourceRootPath: string): Promise<void> {
    await this.fileMover.cleanupEmptyAncestors(dirname(sourcePath), resolve(sourceRootPath));
  }

  async moveToFailedFolder(sourcePath: string, failureRootPath: string, config: Configuration): Promise<string> {
    const fileInfo = parseFileInfo(sourcePath, config.scrape.filenameIgnoreTokens);
    const failedDir = resolve(failureRootPath, config.paths.failedOutputFolder.trim());
    const targetVideoPath = join(failedDir, fileInfo.fileName + fileInfo.extension);
    await ensureParentDirectory(targetVideoPath);
    const movedPath = await this.fileMover.moveBundledMedia(fileInfo.filePath, targetVideoPath, {
      sharedMovieBaseName: fileInfo.number,
    });
    this.logger.info(`Moved failed file to ${failedDir}: ${fileInfo.fileName}`);
    return movedPath;
  }

  private resolveMetadataDir(outputDir: string, config: Configuration): string {
    const configuredMetadataRoot = config.paths.metadataPath.trim();
    if (!configuredMetadataRoot) {
      return outputDir;
    }

    const configuredMediaRoot = config.paths.mediaPath.trim();
    if (!configuredMediaRoot) {
      throw new Error("配置本地元数据目录时，媒体目录不能为空");
    }
    if (!isAbsolute(configuredMediaRoot) || !isAbsolute(configuredMetadataRoot)) {
      throw new Error("媒体目录和本地元数据目录必须使用绝对路径");
    }

    const mediaRoot = resolve(configuredMediaRoot);
    const metadataRoot = resolve(configuredMetadataRoot);
    if (isPathInside(mediaRoot, metadataRoot) || isPathInside(metadataRoot, mediaRoot)) {
      throw new Error("本地元数据目录不能与媒体目录相同或互相包含");
    }

    const outputRelativePath = relative(mediaRoot, resolve(outputDir));
    if (!isPathInside(mediaRoot, outputDir)) {
      throw new Error(`影片输出目录不在媒体目录内：${outputDir}`);
    }

    return resolve(metadataRoot, outputRelativePath);
  }
}

export const fileOrganizer = new FileOrganizer();
