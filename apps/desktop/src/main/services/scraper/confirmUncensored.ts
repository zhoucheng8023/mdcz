import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { fileOrganizer } from "@main/services/scraper/FileScraper";
import { pathExists } from "@main/utils/file";
import { LocalScanService } from "@mdcz/runtime/maintenance";
import {
  commitPublishedMedia,
  createPublicationPlan,
  publishWithConflictResolution,
  type RegisteredPublicationContext,
} from "@mdcz/runtime/publication";
import { confirmUncensoredOutputs, nfoGenerator, type UncensoredConfirmDependencies } from "@mdcz/runtime/scrape";
import type { UncensoredConfirmItem, UncensoredConfirmResultItem } from "@mdcz/shared/types";

const logger = loggerService.getLogger("ConfirmUncensored");

export const createUncensoredConfirmDependencies = (
  publication: RegisteredPublicationContext,
): UncensoredConfirmDependencies => ({
  fileOrganizer,
  localScanService: new LocalScanService(),
  logger,
  nfoGenerator,
  pathExists,
  publish: async ({ operationId, plan }) => {
    const publicationPlan = createPublicationPlan(operationId, "maintenance", plan, publication.roots);
    await publishWithConflictResolution(operationId, async () => {
      await commitPublishedMedia(publicationPlan, {
        ...publication,
        resolveRoot: async (rootId) => {
          const root = publication.roots.find((root) => root.id === rootId);
          if (!root) throw new Error(`Publication root not found: ${rootId}`);
          return root;
        },
        commit: () => undefined,
      });
    });
  },
});

export const confirmUncensoredItems = async (
  items: UncensoredConfirmItem[],
  config: Configuration,
  dependencies: UncensoredConfirmDependencies,
): Promise<{ updatedCount: number; items: UncensoredConfirmResultItem[] }> => {
  const result = await confirmUncensoredOutputs(items, config, dependencies);
  return {
    updatedCount: result.updatedCount,
    items: result.items.map(({ assets: _assets, ...item }) => item),
  };
};
