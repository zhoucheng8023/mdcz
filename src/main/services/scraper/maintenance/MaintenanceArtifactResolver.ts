import { copyFile, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { loggerService } from "@main/services/LoggerService";
import { moveFileSafely, pathExists } from "@main/utils/file";
import type { DiscoveredAssets, DownloadedAssets, LocalScanEntry, MaintenanceAssetDecisions } from "@shared/types";
import type { OrganizePlan } from "../FileOrganizer";

interface ResolvedMaintenanceArtifacts {
  nfoPath?: string;
  assets: DiscoveredAssets;
}

export class MaintenanceArtifactResolver {
  private readonly logger = loggerService.getLogger("MaintenanceArtifactResolver");

  async resolve(input: {
    entry: LocalScanEntry;
    plan?: OrganizePlan;
    outputVideoPath: string;
    assets: DownloadedAssets;
    savedNfoPath?: string;
    preparedActorPhotoPaths?: string[];
    assetDecisions?: MaintenanceAssetDecisions;
  }): Promise<ResolvedMaintenanceArtifacts> {
    if (!input.plan) {
      const nfoPath = input.savedNfoPath ?? input.entry.nfoPath;
      return {
        nfoPath,
        assets: {
          thumb: input.assets.thumb,
          poster: input.assets.poster,
          fanart: input.assets.fanart,
          sceneImages: input.assets.sceneImages,
          trailer: input.assets.trailer,
          nfo: nfoPath,
          actorPhotos:
            (input.preparedActorPhotoPaths?.length ?? 0) > 0
              ? (input.preparedActorPhotoPaths ?? [])
              : input.entry.assets.actorPhotos,
        },
      };
    }

    const outputDir = dirname(input.outputVideoPath);
    const nfoPath = await this.resolveNfoPath(input.entry, input.plan, input.savedNfoPath);

    return {
      nfoPath,
      assets: {
        thumb: await this.resolvePrimaryAsset(input.entry.assets.thumb, input.assets.thumb, outputDir),
        poster: await this.resolvePrimaryAsset(input.entry.assets.poster, input.assets.poster, outputDir),
        fanart: await this.resolvePrimaryAsset(input.entry.assets.fanart, input.assets.fanart, outputDir),
        sceneImages: await this.resolveAssetCollection(
          input.entry.assets.sceneImages,
          input.assets.sceneImages,
          outputDir,
        ),
        trailer: await this.resolvePrimaryAsset(input.entry.assets.trailer, input.assets.trailer, outputDir, {
          discardExisting: input.assetDecisions?.trailer === "replace" && !input.assets.trailer,
        }),
        nfo: nfoPath,
        actorPhotos:
          (input.preparedActorPhotoPaths?.length ?? 0) > 0
            ? (input.preparedActorPhotoPaths ?? [])
            : await this.resolveAssetCollection(input.entry.assets.actorPhotos, [], outputDir),
      },
    };
  }

  toDownloadedAssets(currentAssets: DownloadedAssets, resolvedAssets: DiscoveredAssets): DownloadedAssets {
    return {
      thumb: resolvedAssets.thumb,
      poster: resolvedAssets.poster,
      fanart: resolvedAssets.fanart,
      sceneImages: resolvedAssets.sceneImages,
      trailer: resolvedAssets.trailer,
      downloaded: currentAssets.downloaded,
    };
  }

  private async resolveNfoPath(
    entry: LocalScanEntry,
    plan: OrganizePlan,
    savedNfoPath?: string,
  ): Promise<string | undefined> {
    if (savedNfoPath) {
      await this.removeStaleOriginalNfo(entry.nfoPath, savedNfoPath);
      return savedNfoPath;
    }

    const movedNfoPath = await this.moveKnownAsset(entry.nfoPath, plan.nfoPath);
    if (movedNfoPath) {
      await this.ensureMovieNfoAlias(movedNfoPath);
    }
    return movedNfoPath;
  }

  private async resolvePrimaryAsset(
    sourcePath: string | undefined,
    preferredPath: string | undefined,
    outputDir: string,
    options: {
      discardExisting?: boolean;
    } = {},
  ): Promise<string | undefined> {
    if (preferredPath) {
      return preferredPath;
    }

    if (!sourcePath) {
      return undefined;
    }

    const targetPath = join(outputDir, basename(sourcePath));
    if (options.discardExisting) {
      await this.removeKnownAsset(sourcePath, targetPath);
      return undefined;
    }

    return await this.moveKnownAsset(sourcePath, targetPath);
  }

  private async resolveAssetCollection(
    sourcePaths: string[],
    preferredPaths: string[],
    outputDir: string,
  ): Promise<string[]> {
    if (preferredPaths.length > 0) {
      return preferredPaths;
    }

    const resolved: string[] = [];
    for (const sourcePath of sourcePaths) {
      const targetPath = join(outputDir, basename(dirname(sourcePath)), basename(sourcePath));
      const movedPath = await this.moveKnownAsset(sourcePath, targetPath);
      if (movedPath) {
        resolved.push(movedPath);
      }
    }
    return resolved;
  }

  private async moveKnownAsset(sourcePath: string | undefined, targetPath: string): Promise<string | undefined> {
    if (!sourcePath) {
      return undefined;
    }

    if (sourcePath === targetPath) {
      return (await pathExists(sourcePath)) ? sourcePath : undefined;
    }

    if (!(await pathExists(sourcePath))) {
      return (await pathExists(targetPath)) ? targetPath : undefined;
    }

    if (await pathExists(targetPath)) {
      return targetPath;
    }

    return await moveFileSafely(sourcePath, targetPath);
  }

  private async removeKnownAsset(sourcePath: string | undefined, targetPath: string): Promise<void> {
    const candidates = new Set([sourcePath, targetPath].filter((value): value is string => Boolean(value)));
    for (const filePath of candidates) {
      if (!(await pathExists(filePath))) {
        continue;
      }

      await unlink(filePath).catch(() => undefined);
    }
  }

  private async removeStaleOriginalNfo(originalNfoPath: string | undefined, savedNfoPath: string): Promise<void> {
    if (!originalNfoPath) {
      return;
    }

    const movieNfoPath = join(dirname(savedNfoPath), "movie.nfo");
    if (originalNfoPath === savedNfoPath || originalNfoPath === movieNfoPath) {
      return;
    }

    if (!(await pathExists(originalNfoPath))) {
      return;
    }

    try {
      await unlink(originalNfoPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to remove stale NFO ${originalNfoPath}: ${message}`);
    }
  }

  private async ensureMovieNfoAlias(nfoPath: string): Promise<void> {
    const movieNfoPath = join(dirname(nfoPath), "movie.nfo");
    if (movieNfoPath === nfoPath || !(await pathExists(nfoPath))) {
      return;
    }

    try {
      await copyFile(nfoPath, movieNfoPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to sync movie.nfo alias for ${nfoPath}: ${message}`);
    }
  }
}
