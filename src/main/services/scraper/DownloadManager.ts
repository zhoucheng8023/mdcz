import { copyFile, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { NetworkClient, ProbeResult } from "@main/services/network";
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

/** Optional callbacks for download progress reporting. */
export interface DownloadCallbacks {
  /** Called after each scene image completes (success or fail). */
  onSceneProgress?: (downloaded: number, total: number) => void;
}

type PrimaryImageKey = keyof Pick<DownloadedAssets, "cover" | "poster" | "fanart">;
type PrimaryImageTask = { key: PrimaryImageKey; candidates: string[]; path: string };
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

    const primaryResults = await this.runParallel(primaryTasks, 3, async (task) => {
      return !!(await this.downloadBestImage(task.candidates, task.path));
    });

    for (const result of primaryResults) {
      if (result.success) {
        const key = result.key as PrimaryImageKey;
        assets[key] = result.path;
        assets.downloaded.push(result.path);
      }
    }

    if (config.download.downloadSceneImages) {
      const urls = (data.sample_images ?? [])
        .map((item) => normalizeUrl(item))
        .filter((item): item is string => !!item)
        .slice(0, config.aggregation.behavior.maxSceneImages);

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

      for (const result of sceneResults) {
        if (result.success) {
          assets.sceneImages.push(result.path);
          assets.downloaded.push(result.path);
        }
      }
    }

    const coverPath = assets.cover;
    if (coverPath) {
      if (config.download.downloadPoster && !assets.poster) {
        const posterPath = await this.copyDerivedImage(coverPath, join(outputDir, "poster.jpg"), "poster");
        if (posterPath) {
          assets.poster = posterPath;
          assets.downloaded.push(posterPath);
        }
      }
      if (config.download.downloadFanart && !assets.fanart) {
        const fanartPath = await this.copyDerivedImage(coverPath, join(outputDir, "fanart.jpg"), "fanart");
        if (fanartPath) {
          assets.fanart = fanartPath;
          assets.downloaded.push(fanartPath);
        }
      }
    }

    if (config.download.downloadTrailer) {
      const url = normalizeUrl(data.trailer_url);
      if (url) {
        const trailerPath = join(outputDir, "trailer.mp4");
        const result = await this.safeDownload(url, trailerPath);
        if (result) {
          assets.trailer = trailerPath;
          assets.downloaded.push(trailerPath);
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
      data.cover_url,
      imageAlternatives.cover_url,
      join(outputDir, "cover.jpg"),
    );
    this.addPrimaryImageTask(
      tasks,
      "poster",
      config.download.downloadPoster,
      data.poster_url,
      imageAlternatives.poster_url,
      join(outputDir, "poster.jpg"),
    );
    this.addPrimaryImageTask(
      tasks,
      "fanart",
      config.download.downloadFanart,
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
    primaryUrl: string | undefined,
    alternatives: string[] | undefined,
    path: string,
  ): void {
    if (!enabled) {
      return;
    }

    const candidates = this.buildImageCandidates(primaryUrl, alternatives);
    if (candidates.length > 0) {
      tasks.push({ key, candidates, path });
    }
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
    const downloadedPath = await this.safeDownload(url, outputPath);
    if (!downloadedPath) {
      return null;
    }

    try {
      const validation = await validateImage(outputPath);
      if (validation.valid) {
        return downloadedPath;
      }

      this.logger.warn(`Image invalid (${validation.reason ?? "parse_failed"}): ${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Image validation failed for ${url}: ${message}`);
    }

    await unlink(outputPath).catch(() => undefined);
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
}
