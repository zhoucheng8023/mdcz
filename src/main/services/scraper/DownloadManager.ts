import { copyFile, mkdir, readdir, rename, rm, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient, ProbeResult } from "@main/services/network";
import { pathExists } from "@main/utils/file";
import { validateImage } from "@main/utils/image";
import type { CrawlerData, DownloadedAssets } from "@shared/types";
import type { ImageAlternatives } from "./aggregation";

const normalizeUrl = (input?: string): string | null => {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
};

const resolveExistingAsset = async (assetPath: string): Promise<string | undefined> => {
  return (await pathExists(assetPath)) ? assetPath : undefined;
};

const resolveSingleAsset = async ({
  targetPath,
  keepExisting,
  create,
}: {
  targetPath: string;
  keepExisting: boolean;
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

  return { assetPath: existingPath };
};

/** Optional callbacks for download progress reporting. */
export interface DownloadCallbacks {
  /** Called after each scene image completes (success or fail). */
  onSceneProgress?: (downloaded: number, total: number) => void;
}

type PrimaryImageKey = keyof Pick<DownloadedAssets, "cover" | "poster" | "fanart">;
type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string; keepExisting: boolean };
type SceneImageTask = { key: "sceneImages"; path: string; url: string };
type ParallelResult<K extends string> = { key: K; path: string; success: boolean };
type ProbedImageCandidate = ProbeResult & { index: number; url: string };

export class DownloadManager {
  private readonly logger = loggerService.getLogger("DownloadManager");

  constructor(private readonly networkClient: NetworkClient) {}

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

    const primaryTasks = this.buildPrimaryImageTasks(outputDir, data, config, imageAlternatives);
    const pendingPrimaryTasks: PrimaryImageTask[] = [];

    for (const task of primaryTasks) {
      const existingAsset = await resolveExistingAsset(task.path);
      if (task.keepExisting && existingAsset) {
        assets[task.key] = existingAsset;
        continue;
      }

      if (task.candidates.length > 0) {
        pendingPrimaryTasks.push(task);
      }
    }

    const primaryResults = await this.runParallel(pendingPrimaryTasks, 3, async (task) => {
      return !!(await this.downloadBestImage(task.candidates, task.path));
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
      const sceneDir = join(outputDir, config.paths.sceneImagesFolder);
      const existingSceneImages = await this.listExistingSceneImages(sceneDir);
      if (config.download.keepSceneImages && existingSceneImages.length > 0) {
        assets.sceneImages.push(...existingSceneImages);
      } else {
        const urls = (data.sample_images ?? [])
          .map((item) => normalizeUrl(item))
          .filter((item): item is string => !!item)
          .slice(0, config.aggregation.behavior.maxSceneImages);

        if (urls.length === 0) {
          assets.sceneImages.push(...existingSceneImages);
        } else {
          const sceneTasks: SceneImageTask[] = urls.map((url, index) => ({
            url,
            path: join(outputDir, config.paths.sceneImagesFolder, `scene-${String(index + 1).padStart(3, "0")}.jpg`),
            key: "sceneImages" as const,
          }));

          let sceneCompleted = 0;
          const sceneResults = await this.runParallel(
            sceneTasks,
            config.download.sceneImageConcurrency,
            async (task) => !!(await this.downloadAndValidateImage(task.url, task.path)),
            () => {
              sceneCompleted++;
              callbacks?.onSceneProgress?.(sceneCompleted, sceneTasks.length);
            },
          );

          const existingSceneSet = new Set(existingSceneImages);
          for (const [index, result] of sceneResults.entries()) {
            const task = sceneTasks[index];
            if (!task) {
              continue;
            }

            if (result?.success) {
              assets.sceneImages.push(result.path);
              assets.downloaded.push(result.path);
              continue;
            }

            if (existingSceneSet.has(task.path)) {
              assets.sceneImages.push(task.path);
            }
          }

          if (assets.sceneImages.length > 0) {
            await this.removeStaleSceneImages(existingSceneImages, assets.sceneImages, sceneDir);
          }
        }
      }
    }

    const coverPath = assets.cover;
    if (coverPath) {
      if (config.download.downloadPoster && !assets.poster) {
        const posterTargetPath = join(outputDir, "poster.jpg");
        const posterResult = await resolveSingleAsset({
          targetPath: posterTargetPath,
          keepExisting: config.download.keepPoster,
          create: () => this.copyDerivedImage(coverPath, posterTargetPath, "poster"),
        });
        if (posterResult.assetPath) {
          assets.poster = posterResult.assetPath;
          if (posterResult.createdPath) {
            assets.downloaded.push(posterResult.createdPath);
          }
        }
      }
      if (config.download.downloadFanart && !assets.fanart) {
        const fanartTargetPath = join(outputDir, "fanart.jpg");
        const fanartResult = await resolveSingleAsset({
          targetPath: fanartTargetPath,
          keepExisting: config.download.keepFanart,
          create: () => this.copyDerivedImage(coverPath, fanartTargetPath, "fanart"),
        });
        if (fanartResult.assetPath) {
          assets.fanart = fanartResult.assetPath;
          if (fanartResult.createdPath) {
            assets.downloaded.push(fanartResult.createdPath);
          }
        }
      }
    }

    if (config.download.downloadTrailer) {
      const trailerPath = join(outputDir, "trailer.mp4");
      const url = normalizeUrl(data.trailer_url);
      const trailerResult = await resolveSingleAsset({
        targetPath: trailerPath,
        keepExisting: config.download.keepTrailer,
        create: async () => (url ? this.safeDownload(url, trailerPath) : null),
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
      "cover",
      config.download.downloadCover,
      config.download.keepCover,
      data.cover_url,
      imageAlternatives.cover_url,
      join(outputDir, "cover.jpg"),
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
    this.addPrimaryImageTask(
      tasks,
      "fanart",
      config.download.downloadFanart,
      config.download.keepFanart,
      data.fanart_url,
      imageAlternatives.fanart_url,
      join(outputDir, "fanart.jpg"),
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

  private async runParallel<K extends string, TTask extends { key: K; path: string }>(
    tasks: TTask[],
    maxConcurrent: number,
    runner: (task: TTask) => Promise<boolean>,
    onItemComplete?: () => void,
  ): Promise<Array<ParallelResult<K>>> {
    const results: Array<ParallelResult<K>> = new Array(tasks.length);
    let completed = 0;
    let running = 0;
    let nextIndex = 0;

    if (tasks.length === 0) return results;

    return new Promise((resolve) => {
      const tryLaunchNext = (): void => {
        while (running < maxConcurrent && nextIndex < tasks.length) {
          const taskIndex = nextIndex++;
          const task = tasks[taskIndex];
          running++;

          runner(task)
            .then((success) => {
              results[taskIndex] = { key: task.key, path: task.path, success };
            })
            .catch((error) => {
              const message = error instanceof Error ? error.message : String(error);
              this.logger.warn(`Parallel task failed for ${task.path}: ${message}`);
              results[taskIndex] = { key: task.key, path: task.path, success: false };
            })
            .finally(() => {
              completed += 1;
              running--;
              onItemComplete?.();
              if (completed === tasks.length) {
                resolve(results);
              } else {
                tryLaunchNext();
              }
            });
        }
      };

      tryLaunchNext();
    });
  }

  private async downloadBestImage(candidates: string[], outputPath: string): Promise<string | null> {
    if (candidates.length === 0) {
      return null;
    }

    for (const url of await this.orderImageCandidatesByProbe(candidates)) {
      const downloadedPath = await this.downloadAndValidateImage(url, outputPath);
      if (downloadedPath) {
        return downloadedPath;
      }
    }

    return null;
  }

  private async downloadAndValidateImage(url: string, outputPath: string): Promise<string | null> {
    const tempPath = `${outputPath}.part`;
    const downloadedPath = await this.safeDownload(url, tempPath);
    if (!downloadedPath) {
      return null;
    }

    try {
      const validation = await validateImage(tempPath);
      if (validation.valid) {
        await unlink(outputPath).catch(() => undefined);
        await rename(tempPath, outputPath);
        return outputPath;
      }

      this.logger.warn(`Image invalid (${validation.reason ?? "parse_failed"}): ${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Image validation failed for ${url}: ${message}`);
    }

    await unlink(tempPath).catch(() => undefined);
    return null;
  }

  private async orderImageCandidatesByProbe(candidates: string[]): Promise<string[]> {
    const probedCandidates = await Promise.all(candidates.map((url, index) => this.probeImageCandidate(url, index)));
    const successfulUrls = probedCandidates
      .filter((candidate) => candidate.ok)
      .sort((a, b) => (b.contentLength ?? 0) - (a.contentLength ?? 0) || a.index - b.index)
      .map((candidate) => candidate.url);

    const attemptedUrls = new Set(successfulUrls);
    return [...successfulUrls, ...candidates.filter((url) => !attemptedUrls.has(url))];
  }

  private async probeImageCandidate(url: string, index: number): Promise<ProbedImageCandidate> {
    try {
      const result = await this.networkClient.probe(url);
      return { ...result, index, url };
    } catch {
      return {
        url,
        index,
        ok: false,
        contentLength: null,
        status: 0,
        resolvedUrl: url,
      };
    }
  }

  private async copyDerivedImage(sourcePath: string, targetPath: string, targetLabel: string): Promise<string | null> {
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      await copyFile(sourcePath, targetPath);
      return targetPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to derive ${targetLabel} from cover: ${message}`);
      return null;
    }
  }

  private async safeDownload(url: string, outputPath: string): Promise<string | null> {
    try {
      return await this.networkClient.download(url, outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Download failed for ${url}: ${message}`);
      return null;
    }
  }

  private async listExistingSceneImages(sceneDir: string): Promise<string[]> {
    try {
      const entries = await readdir(sceneDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && /^scene-\d+/iu.test(entry.name))
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
