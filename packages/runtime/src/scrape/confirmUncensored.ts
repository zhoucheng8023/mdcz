import { dirname } from "node:path";
import type { MediaRoot } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import { toErrorMessage } from "@mdcz/shared/error";
import type {
  CrawlerData,
  DiscoveredAssets,
  FileId,
  FileInfo,
  LocalScanEntry,
  NfoLocalState,
  UncensoredChoice,
  UncensoredConfirmResultItem,
} from "@mdcz/shared/types";
import type { LocalScanService } from "../maintenance/LocalScanService";
import { buildMovieTags } from "../maintenance/movieTags";
import { type PreparedPublicationPlan, preparePublicationPlan } from "../publication";
import type { RuntimeLogger } from "../shared";
import type { FileOrganizer, OrganizePlan } from "./FileOrganizer";
import { type NfoGenerator, nfoIgnoreFieldsToEnabledFields } from "./nfo";
import { parseFileInfo } from "./utils/number";

export interface RuntimeUncensoredConfirmItem {
  fileId: FileId;
  videoPath: string;
  metadataVideoPath?: string;
  nfoPath?: string;
  crawlerData?: CrawlerData;
  choice: UncensoredChoice;
}

export interface RuntimeUncensoredConfirmFailure {
  fileId: FileId;
  videoPath: string;
  message: string;
}

export interface RuntimeUncensoredConfirmResult {
  updatedCount: number;
  items: Array<UncensoredConfirmResultItem & { assets: DiscoveredAssets }>;
  failures: RuntimeUncensoredConfirmFailure[];
}

interface PreparedUncensoredConfirmItem {
  item: RuntimeUncensoredConfirmItem;
  entry: LocalScanEntry;
  effectiveNfoPath: string;
  nextLocalState: NfoLocalState;
}

export interface UncensoredConfirmDependencies {
  fileOrganizer: Pick<FileOrganizer, "plan" | "resolveOutputPlan">;
  localScanService: Pick<LocalScanService, "scanVideo">;
  logger: Pick<RuntimeLogger, "info" | "warn">;
  nfoGenerator: Pick<NfoGenerator, "writeNfo">;
  pathExists: (filePath: string) => Promise<boolean>;
  publish(input: { operationId: string; plan: PreparedPublicationPlan }): Promise<void>;
}

const buildBatchKey = (nfoPath: string, choice: UncensoredChoice): string => `${nfoPath.trim()}::${choice}`;

const buildSharedFileInfo = (entries: LocalScanEntry[], outputVideoPath: string): FileInfo | undefined => {
  const firstEntry = entries[0];
  if (!firstEntry) return undefined;
  const subtitleSource = entries.find((entry) => entry.fileInfo.isSubtitled || Boolean(entry.fileInfo.subtitleTag));
  return {
    ...firstEntry.fileInfo,
    filePath: outputVideoPath,
    isSubtitled: entries.some((entry) => entry.fileInfo.isSubtitled),
    subtitleTag: subtitleSource?.fileInfo.subtitleTag,
    part: undefined,
  };
};

export const confirmUncensoredOutputs = async (
  items: RuntimeUncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies,
): Promise<RuntimeUncensoredConfirmResult> => {
  const updatedItems: Array<UncensoredConfirmResultItem & { assets: DiscoveredAssets }> = [];
  const failures: RuntimeUncensoredConfirmFailure[] = [];
  const preparedItems: PreparedUncensoredConfirmItem[] = [];
  const fail = (item: RuntimeUncensoredConfirmItem, message: string): void => {
    dependencies.logger.warn(message);
    failures.push({ fileId: item.fileId, videoPath: item.videoPath, message });
  };

  for (const item of items) {
    try {
      const nfoPath = item.nfoPath?.trim();
      const videoPath = item.videoPath.trim();
      if (
        !nfoPath ||
        !videoPath ||
        !(await dependencies.pathExists(nfoPath)) ||
        !(await dependencies.pathExists(videoPath))
      ) {
        fail(item, `Skipping uncensored confirm: output files not found for ${videoPath || nfoPath}`);
        continue;
      }

      const scanPath = item.metadataVideoPath?.trim() || videoPath;
      const root: MediaRoot = {
        id: item.fileId,
        displayName: dirname(scanPath),
        hostPath: dirname(scanPath),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const scannedEntry = await dependencies.localScanService.scanVideo(
        root,
        scanPath,
        config.paths.sceneImagesFolder,
      );
      const effectiveNfoPath = scannedEntry.nfoPath ?? nfoPath;
      const crawlerData = item.crawlerData ?? scannedEntry.crawlerData;
      if (!effectiveNfoPath || !crawlerData || !(await dependencies.pathExists(effectiveNfoPath))) {
        fail(item, `Skipping uncensored confirm: incomplete local output for ${videoPath}`);
        continue;
      }

      const entry = {
        ...scannedEntry,
        fileInfo: {
          ...parseFileInfo(videoPath, config.scrape.filenameIgnoreTokens),
          isSubtitled: scannedEntry.fileInfo.isSubtitled,
          subtitleTag: scannedEntry.fileInfo.subtitleTag,
        },
        crawlerData,
        currentDir: dirname(videoPath),
      };
      preparedItems.push({
        item,
        entry,
        effectiveNfoPath,
        nextLocalState: { ...entry.nfoLocalState, uncensoredChoice: item.choice },
      });
    } catch (error) {
      fail(item, `Failed to prepare uncensored confirmation for ${item.videoPath}: ${toErrorMessage(error)}`);
    }
  }

  const batches = new Map<string, PreparedUncensoredConfirmItem[]>();
  const choicesByNfoPath = new Map<string, Set<UncensoredChoice>>();
  for (const prepared of preparedItems) {
    const choices = choicesByNfoPath.get(prepared.effectiveNfoPath) ?? new Set<UncensoredChoice>();
    choices.add(prepared.item.choice);
    choicesByNfoPath.set(prepared.effectiveNfoPath, choices);
  }
  for (const prepared of preparedItems) {
    if ((choicesByNfoPath.get(prepared.effectiveNfoPath)?.size ?? 0) > 1) {
      fail(prepared.item, `Conflicting uncensored choices for shared NFO: ${prepared.effectiveNfoPath}`);
      continue;
    }
    const key = buildBatchKey(prepared.effectiveNfoPath, prepared.item.choice);
    batches.set(key, [...(batches.get(key) ?? []), prepared]);
  }

  for (const batchItems of batches.values()) {
    const processedItems: Array<PreparedUncensoredConfirmItem & { outputVideoPath: string; plan: OrganizePlan }> = [];
    for (const prepared of batchItems) {
      try {
        const rawPlan = dependencies.fileOrganizer.plan(
          prepared.entry.fileInfo,
          prepared.entry.crawlerData as CrawlerData,
          config,
          prepared.nextLocalState,
        );
        const plan = await dependencies.fileOrganizer.resolveOutputPlan(rawPlan, prepared.entry.fileInfo.filePath);
        const outputVideoPath = plan.targetVideoPath;
        processedItems.push({ ...prepared, outputVideoPath, plan });
      } catch (error) {
        fail(prepared.item, `Failed to reorganize ${prepared.item.videoPath}: ${toErrorMessage(error)}`);
      }
    }
    if (processedItems.length === 0) continue;
    if (processedItems.length !== batchItems.length) {
      for (const processed of processedItems) fail(processed.item, "Cannot partially reorganize videos sharing an NFO");
      continue;
    }

    let savedNfoPath: string;
    const nfoArtifacts = new Map<string, string>();
    try {
      const seed = processedItems[0];
      savedNfoPath = await dependencies.nfoGenerator.writeNfo(
        seed.plan.nfoPath,
        seed.entry.crawlerData as CrawlerData,
        {
          fileInfo: buildSharedFileInfo(
            processedItems.map((item) => item.entry),
            seed.outputVideoPath,
          ),
          localState: seed.nextLocalState,
          nfoNaming: config.download.nfoNaming,
          enabledFields: nfoIgnoreFieldsToEnabledFields(config.download.nfoIgnoreFields),
          nfoTitleTemplate: config.naming.nfoTitleTemplate,
          buildTags: buildMovieTags,
          writeFile: async (targetPath, content) => {
            nfoArtifacts.set(targetPath, content);
          },
        },
      );
    } catch (error) {
      const message = `Failed to write uncensored confirmation NFO: ${toErrorMessage(error)}`;
      for (const processed of processedItems) fail(processed.item, message);
      continue;
    }

    try {
      const finalizedItems = [];
      for (const processed of processedItems) {
        const publication = await preparePublicationPlan({
          sourceVideoPath: processed.item.videoPath,
          outputVideoPath: processed.outputVideoPath,
          existingAssetDir: dirname(processed.effectiveNfoPath),
          metadataOutputDir: processed.plan.metadataDir ?? processed.plan.outputDir,
          downloadedAssets: { downloaded: [], sceneImages: [] },
          actorPhotoPaths: [],
          existingAssets: processed.entry.assets,
          existingNfoPath: processed.effectiveNfoPath,
          existingStrmPath: processed.item.metadataVideoPath,
          movingVideoPaths: processedItems.map(({ item }) => item.videoPath),
          organizePlan: processed.plan,
          nfoNaming: config.download.nfoNaming,
          writeNfo: async (_assets, writeFile) => {
            for (const [targetPath, content] of nfoArtifacts) await writeFile(targetPath, content);
            return savedNfoPath;
          },
        });
        finalizedItems.push({ processed, publication });
      }
      const plans = finalizedItems.map(({ publication }) => publication.plan);
      const moves = new Map<string, NonNullable<PreparedPublicationPlan["sidecars"]>[number]>();
      const artifacts = new Map<string, PreparedPublicationPlan["artifacts"][number]>();
      for (const plan of plans) {
        for (const move of plan.sidecars ?? []) {
          const previous = moves.get(move.targetPath);
          if (previous && previous.sourcePath !== move.sourcePath)
            throw new Error(`Conflicting batch sources: ${move.targetPath}`);
          moves.set(move.targetPath, move);
        }
        for (const artifact of plan.artifacts) {
          const previous = artifacts.get(artifact.targetPath);
          if (previous && !Buffer.from(previous.content.data).equals(Buffer.from(artifact.content.data)))
            throw new Error(`Conflicting batch artifacts: ${artifact.targetPath}`);
          artifacts.set(artifact.targetPath, artifact);
        }
      }
      const retained = new Set([...moves.keys(), ...artifacts.keys()]);
      await dependencies.publish({
        operationId: `uncensored-confirm:${processedItems.map(({ item }) => item.fileId).join(":")}`,
        plan: {
          videos: plans.flatMap((plan) => plan.videos ?? []),
          sidecars: [...moves.values()],
          artifacts: [...artifacts.values()],
          assets: plans.flatMap((plan) => plan.assets),
          obsoletePaths: [...new Set(plans.flatMap((plan) => plan.obsoletePaths))].filter(
            (path) => !retained.has(path),
          ),
          replaceExistingTargetPaths: [...new Set(plans.flatMap((plan) => plan.replaceExistingTargetPaths ?? []))],
        },
      });
      for (const { processed, publication } of finalizedItems) {
        updatedItems.push({
          fileId: processed.item.fileId,
          sourceVideoPath: processed.item.videoPath,
          sourceNfoPath: processed.effectiveNfoPath,
          targetVideoPath: processed.outputVideoPath,
          targetNfoPath: publication.nfoPath,
          choice: processed.item.choice,
          assets: publication.assets,
        });
        dependencies.logger.info(
          `Updated uncensored choice to "${processed.item.choice}" for ${processed.item.videoPath}`,
        );
      }
    } catch (error) {
      for (const processed of processedItems)
        fail(processed.item, `Failed to finalize ${processed.item.videoPath}: ${toErrorMessage(error)}`);
    }
  }

  return { updatedCount: updatedItems.length, items: updatedItems, failures };
};
