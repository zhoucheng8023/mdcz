import { mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Configuration } from "@main/services/config";
import { PersistentCooldownStore } from "@main/services/cooldown/PersistentCooldownStore";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient } from "@main/services/network";
import { toErrorMessage } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import type { CrawlerData, DownloadedAssets, MaintenanceAssetDecisions } from "@shared/types";
import { isAbortError, throwIfAborted } from "./abort";
import type { ImageAlternatives } from "./aggregation";
import { ImageDownloadService } from "./download/ImageDownloadService";
import { ImageHostCooldownTracker, normalizeUrl } from "./download/ImageHostCooldownTracker";
import { SceneImageDownloader, type SceneImageSet } from "./download/SceneImageDownloader";

const resolveExistingAsset = async (assetPath: string): Promise<string | undefined> => {
  return (await pathExists(assetPath)) ? assetPath : undefined;
};

const resolveSingleAsset = async ({
  targetPath,
  keepExisting,
  fallbackToExistingOnFailure = true,
  create,
}: {
  targetPath: string;
  keepExisting: boolean;
  fallbackToExistingOnFailure?: boolean;
  create: () => Promise<string | null>;
}): Promise<{ assetPath?: string; createdPath?: string }> => {
  const existingPath = await resolveExistingAsset(targetPath);
  if (keepExisting && existingPath) {
    return { assetPath: existingPath };
  }

  const createdPath = await create();
  if (createdPath) {
    return { assetPath: createdPath, createdPath };
  }

  return fallbackToExistingOnFailure ? { assetPath: existingPath } : {};
};

/** Optional callbacks for download progress reporting. */
export interface DownloadCallbacks {
  /** Called after each scene image completes (success or fail). */
  onSceneProgress?: (downloaded: number, total: number) => void;
  /** Reports the exact remote URLs that produced the finalized local scene image set for this scrape. */
  onResolvedSceneImageUrls?: (urls: string[] | undefined) => void;
  /** Force a primary image to refresh even when its keep flag is enabled. */
  forceReplace?: Partial<Record<PrimaryImageKey, boolean>>;
  /** Preserve or replace selected maintenance-managed assets regardless of preset keep flags. */
  assetDecisions?: MaintenanceAssetDecisions;
  /** Cancels in-flight work when the current scrape is stopped. */
  signal?: AbortSignal;
}

type PrimaryImageKey = keyof Pick<DownloadedAssets, "thumb" | "poster" | "fanart">;
type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string; keepExisting: boolean };
type ParallelResult<K extends string, TValue> = { key: K; path: string; success: boolean; value?: TValue };
type AssetDecision = MaintenanceAssetDecisions[keyof MaintenanceAssetDecisions];

interface DownloadManagerOptions {
  imageHostCooldownStore?: PersistentCooldownStore;
}

const uniqueFilePaths = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    paths.push(value);
  }

  return paths;
};

const getNormalizedSceneImageUrls = (values: string[]): string[] => {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const item of values) {
    const normalized = normalizeUrl(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
};

const getSceneImageSets = (
  data: CrawlerData,
  imageAlternatives: Partial<ImageAlternatives>,
  maxSceneImages: number,
): SceneImageSet[] => {
  if (maxSceneImages <= 0) {
    return [];
  }

  const seenSets = new Set<string>();
  const sets: SceneImageSet[] = [];
  const candidates: SceneImageSet[] = [
    {
      urls: data.scene_images,
      source: imageAlternatives.scene_images_source,
    },
    ...(imageAlternatives.scene_images ?? []).map((urls, index) => ({
      urls,
      source: imageAlternatives.scene_image_sources?.[index],
    })),
  ];

  for (const candidate of candidates) {
    const values = candidate.urls;
    const urls = getNormalizedSceneImageUrls(Array.isArray(values) ? values : []).slice(0, maxSceneImages);
    if (urls.length === 0) {
      continue;
    }

    const signature = JSON.stringify(urls);
    if (seenSets.has(signature)) {
      continue;
    }

    seenSets.add(signature);
    sets.push({
      urls,
      source: candidate.source,
    });
  }

  return sets;
};

const shouldKeepAsset = (decision: AssetDecision | undefined, defaultKeep: boolean): boolean => {
  if (decision === "preserve") {
    return true;
  }

  if (decision === "replace") {
    return false;
  }

  return defaultKeep;
};

const shouldFallbackToExistingAsset = (decision: AssetDecision | undefined): boolean => {
  return decision !== "replace";
};

const isExtrafanartFolder = (folderName: string): boolean => {
  return (
    folderName
      .trim()
      .replace(/[\\/]+$/u, "")
      .toLowerCase() === "extrafanart"
  );
};

const buildSceneImageFileName = (sceneFolder: string, index: number): string => {
  if (isExtrafanartFolder(sceneFolder)) {
    return `fanart${index + 1}.jpg`;
  }

  return `scene-${String(index + 1).padStart(3, "0")}.jpg`;
};

const SCENE_IMAGE_FILE_PATTERN = /^(?:scene-\d+|fanart\d+)\.(?:jpe?g|png|webp)$/iu;

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  private readonly imageDownloader: ImageDownloadService;

  private readonly sceneImageDownloader: SceneImageDownloader;

  constructor(networkClient: NetworkClient, options: DownloadManagerOptions = {}) {
    const imageHostCooldownStore =
      options.imageHostCooldownStore ??
      new PersistentCooldownStore({
        fileName: "image-host-cooldowns.json",
        loggerName: "ImageHostCooldownStore",
      });
    const hostCooldownTracker = new ImageHostCooldownTracker(imageHostCooldownStore, this.logger);

    this.imageDownloader = new ImageDownloadService(networkClient, hostCooldownTracker, this.logger);
    this.sceneImageDownloader = new SceneImageDownloader(this.imageDownloader, hostCooldownTracker, this.logger);
  }

  async downloadAll(
    outputDir: string,
    data: CrawlerData,
    config: Configuration,
    imageAlternatives: Partial<ImageAlternatives> = {},
    callbacks?: DownloadCallbacks,
  ): Promise<DownloadedAssets> {
    const assets: DownloadedAssets = {
      sceneImages: [],
      downloaded: [],
    };

    throwIfAborted(callbacks?.signal);

    const forceReplace = callbacks?.forceReplace ?? {};
    const assetDecisions = callbacks?.assetDecisions ?? {};
    const primaryTasks = this.buildPrimaryImageTasks(outputDir, data, config, imageAlternatives);
    const pendingPrimaryTasks: PrimaryImageTask[] = [];

    for (const task of primaryTasks) {
      const existingAsset = await resolveExistingAsset(task.path);
      if (task.keepExisting && existingAsset && !forceReplace[task.key]) {
        assets[task.key] = existingAsset;
        continue;
      }

      if (task.candidates.length > 0) {
        pendingPrimaryTasks.push(task);
      }
    }

    const primaryResults = await this.runParallel(pendingPrimaryTasks, 3, async (task) => {
      return await this.imageDownloader.downloadBestImage(task.candidates, task.path, callbacks?.signal);
    });

    for (const result of primaryResults) {
      if (result.success) {
        const key = result.key as PrimaryImageKey;
        assets[key] = result.path;
        assets.downloaded.push(result.path);
      }
    }

    for (const task of primaryTasks) {
      if (!assets[task.key]) {
        const existingAsset = await resolveExistingAsset(task.path);
        if (existingAsset) {
          assets[task.key] = existingAsset;
        }
      }
    }

    if (config.download.downloadSceneImages) {
      throwIfAborted(callbacks?.signal);
      const sceneDir = join(outputDir, config.paths.sceneImagesFolder);
      const existingSceneImages = await this.listExistingSceneImages(sceneDir);
      const sceneImageComparisonPaths = uniqueFilePaths([
        assets.thumb,
        await resolveExistingAsset(join(outputDir, "fanart.jpg")),
      ]);
      const forceReplaceSceneImages = assetDecisions.sceneImages === "replace";
      const keepSceneImages = shouldKeepAsset(assetDecisions.sceneImages, config.download.keepSceneImages);

      if (keepSceneImages && existingSceneImages.length > 0) {
        assets.sceneImages.push(...existingSceneImages);
      } else {
        throwIfAborted(callbacks?.signal);
        const targetSceneCount = Math.max(0, config.aggregation.behavior.maxSceneImages);
        const sceneImageSets = getSceneImageSets(data, imageAlternatives, targetSceneCount);

        if (sceneImageSets.length === 0) {
          if (forceReplaceSceneImages && existingSceneImages.length > 0) {
            await this.removeStaleSceneImages(existingSceneImages, [], sceneDir);
          } else {
            assets.sceneImages.push(...existingSceneImages);
          }
          if (existingSceneImages.length > 0 && !forceReplaceSceneImages) {
            callbacks?.onResolvedSceneImageUrls?.(undefined);
          } else {
            callbacks?.onResolvedSceneImageUrls?.([]);
          }
        } else {
          const successfulSceneImages = await this.sceneImageDownloader.downloadSceneImageSets({
            outputDir,
            sceneFolder: config.paths.sceneImagesFolder,
            sceneImageSets,
            targetSceneCount,
            maxConcurrent: config.download.sceneImageConcurrency,
            dedupeAgainstPaths: sceneImageComparisonPaths,
            signal: callbacks?.signal,
            onSceneProgress: callbacks?.onSceneProgress,
          });

          const finalizedSceneCount = Math.min(targetSceneCount, successfulSceneImages.length);
          for (let index = 0; index < finalizedSceneCount; index += 1) {
            const sceneImage = successfulSceneImages[index];
            if (!sceneImage) {
              continue;
            }

            const finalPath = join(
              outputDir,
              config.paths.sceneImagesFolder,
              buildSceneImageFileName(config.paths.sceneImagesFolder, index),
            );

            await mkdir(dirname(finalPath), { recursive: true });
            await unlink(finalPath).catch(() => undefined);
            if (sceneImage.path !== finalPath) {
              await rename(sceneImage.path, finalPath);
            }
            assets.sceneImages.push(finalPath);
            assets.downloaded.push(finalPath);
          }

          for (let index = finalizedSceneCount; index < successfulSceneImages.length; index += 1) {
            await unlink(successfulSceneImages[index]?.path ?? "").catch(() => undefined);
          }

          if (!forceReplaceSceneImages && finalizedSceneCount === 0) {
            assets.sceneImages.push(...existingSceneImages.slice(0, targetSceneCount));
          }

          if (finalizedSceneCount > 0) {
            callbacks?.onResolvedSceneImageUrls?.(
              successfulSceneImages.slice(0, finalizedSceneCount).map((item) => item.url),
            );
          } else if (!forceReplaceSceneImages && existingSceneImages.length > 0) {
            callbacks?.onResolvedSceneImageUrls?.(undefined);
          } else {
            callbacks?.onResolvedSceneImageUrls?.([]);
          }

          if (assets.sceneImages.length > 0 || forceReplaceSceneImages) {
            await this.removeStaleSceneImages(existingSceneImages, assets.sceneImages, sceneDir);
          }
        }
      }
    }

    if (config.download.downloadFanart) {
      throwIfAborted(callbacks?.signal);
      const fanartTargetPath = join(outputDir, "fanart.jpg");
      const thumbPath = assets.thumb;

      if (thumbPath) {
        const thumbWasRefreshed = assets.downloaded.includes(thumbPath) || forceReplace.fanart;
        const keepFanart = thumbWasRefreshed
          ? false
          : shouldKeepAsset(assetDecisions.fanart, config.download.keepFanart);

        const fanartResult = await resolveSingleAsset({
          targetPath: fanartTargetPath,
          keepExisting: keepFanart,
          create: () => this.imageDownloader.copyDerivedImage(thumbPath, fanartTargetPath, "fanart"),
        });
        if (fanartResult.assetPath) {
          assets.fanart = fanartResult.assetPath;
          if (fanartResult.createdPath) {
            assets.downloaded.push(fanartResult.createdPath);
          }
        }
      } else {
        const existingFanart = await resolveExistingAsset(fanartTargetPath);
        if (existingFanart) {
          assets.fanart = existingFanart;
        }
      }
    }

    if (config.download.downloadTrailer) {
      throwIfAborted(callbacks?.signal);
      const trailerPath = join(outputDir, "trailer.mp4");
      const url = normalizeUrl(data.trailer_url);
      const keepTrailer = shouldKeepAsset(assetDecisions.trailer, config.download.keepTrailer);
      const trailerResult = await resolveSingleAsset({
        targetPath: trailerPath,
        keepExisting: keepTrailer,
        fallbackToExistingOnFailure: shouldFallbackToExistingAsset(assetDecisions.trailer),
        create: async () => {
          if (!url) {
            return null;
          }

          const downloadResult = await this.imageDownloader.downloadFile(url, trailerPath, {
            signal: callbacks?.signal,
          });
          return downloadResult.status === "downloaded" ? downloadResult.path : null;
        },
      });
      if (trailerResult.assetPath) {
        assets.trailer = trailerResult.assetPath;
        if (trailerResult.createdPath) {
          assets.downloaded.push(trailerResult.createdPath);
        }
      }
    }

    return assets;
  }

  private buildPrimaryImageTasks(
    outputDir: string,
    data: CrawlerData,
    config: Configuration,
    imageAlternatives: Partial<ImageAlternatives>,
  ): PrimaryImageTask[] {
    const tasks: PrimaryImageTask[] = [];

    this.addPrimaryImageTask(
      tasks,
      "thumb",
      config.download.downloadThumb,
      config.download.keepThumb,
      data.thumb_url,
      imageAlternatives.thumb_url,
      join(outputDir, "thumb.jpg"),
    );
    this.addPrimaryImageTask(
      tasks,
      "poster",
      config.download.downloadPoster,
      config.download.keepPoster,
      data.poster_url,
      imageAlternatives.poster_url,
      join(outputDir, "poster.jpg"),
    );

    return tasks;
  }

  private addPrimaryImageTask(
    tasks: PrimaryImageTask[],
    key: PrimaryImageKey,
    enabled: boolean,
    keepExisting: boolean,
    primaryUrl: string | undefined,
    alternatives: string[] | undefined,
    path: string,
  ): void {
    if (!enabled) {
      return;
    }

    const candidates = this.buildImageCandidates(primaryUrl, alternatives);
    tasks.push({ key, candidates, path, keepExisting });
  }

  private buildImageCandidates(primaryUrl?: string, alternatives?: string[]): string[] {
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const url of [primaryUrl, ...(alternatives ?? [])]) {
      const normalized = normalizeUrl(url);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      candidates.push(normalized);
    }

    return candidates;
  }

  private async runParallel<K extends string, TTask extends { key: K; path: string }, TValue>(
    tasks: TTask[],
    maxConcurrent: number,
    runner: (task: TTask) => Promise<TValue | undefined>,
    onItemComplete?: () => void,
  ): Promise<Array<ParallelResult<K, TValue>>> {
    const results: Array<ParallelResult<K, TValue>> = new Array(tasks.length);
    if (tasks.length === 0) {
      return results;
    }

    let nextIndex = 0;
    const workerCount = Math.min(tasks.length, Math.max(1, maxConcurrent));
    const runWorker = async (): Promise<void> => {
      while (true) {
        const taskIndex = nextIndex++;
        const task = tasks[taskIndex];
        if (!task) {
          return;
        }

        try {
          const value = await runner(task);
          results[taskIndex] = {
            key: task.key,
            path: task.path,
            success: value !== undefined,
            value,
          };
        } catch (error) {
          if (isAbortError(error)) {
            throw error;
          }
          const message = toErrorMessage(error);
          this.logger.warn(`Parallel task failed for ${task.path}: ${message}`);
          results[taskIndex] = { key: task.key, path: task.path, success: false };
        } finally {
          onItemComplete?.();
        }
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
  }

  private async listExistingSceneImages(sceneDir: string): Promise<string[]> {
    try {
      const entries = await readdir(sceneDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && SCENE_IMAGE_FILE_PATTERN.test(entry.name))
        .map((entry) => join(sceneDir, entry.name))
        .sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private async removeStaleSceneImages(
    existingPaths: string[],
    activePaths: string[],
    sceneDir: string,
  ): Promise<void> {
    const activeSet = new Set(activePaths);
    const stalePaths = existingPaths.filter((filePath) => !activeSet.has(filePath));

    for (const stalePath of stalePaths) {
      await unlink(stalePath).catch(() => undefined);
    }

    if (stalePaths.length === 0) {
      return;
    }

    try {
      const remaining = await readdir(sceneDir);
      if (remaining.length === 0) {
        await rm(sceneDir, { recursive: true });
      }
    } catch {
      /* directory may not exist */
    }
  }
}
