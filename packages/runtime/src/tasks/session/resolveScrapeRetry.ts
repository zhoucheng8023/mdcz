import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { type MediaRoot, resolveRootRelativePath } from "@mdcz/media-store";
import type { Configuration } from "@mdcz/shared/config";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import { preflightScrapeTask } from "../../scrape/preflightScrapeTask";

export const resolveScrapeAttempts = <TOutcome extends { attemptId: string; itemId: string }>(manifest: {
  attempts: readonly { id: string; itemId: string }[];
  outcomes: readonly TOutcome[];
}) => {
  const settled = new Set(manifest.outcomes.map((outcome) => outcome.attemptId));
  return {
    openAttemptByItemId: new Map(
      manifest.attempts.filter((attempt) => !settled.has(attempt.id)).map((attempt) => [attempt.itemId, attempt.id]),
    ),
    latestOutcomeByItemId: new Map(manifest.outcomes.map((outcome) => [outcome.itemId, outcome])),
  };
};

export const resolveScrapeRetry = async (input: {
  item: RootFileRef;
  retrying: boolean;
  latestOutcome?: { outcome: string; outputRootId: string | null; outputRelativePath: string | null };
  outputRoot: Pick<MediaRoot, "id" | "hostPath">;
  outputRelativeDirectory: string;
  failedOutputFolder: string;
  resolveRoot(id: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): Promise<{ sourcePath: string; executionSource?: RootFileRef; outputBaseDirectory?: string }> => {
  const sourceRoot = await input.resolveRoot(input.item.rootId);
  const sourcePath = resolveRootRelativePath(sourceRoot, input.item.relativePath);
  if (!input.retrying) return { sourcePath };
  const candidates: RootFileRef[] = [];
  const outcome = input.latestOutcome;
  if (outcome?.outcome === "success" && outcome.outputRootId && outcome.outputRelativePath) {
    candidates.push({ rootId: outcome.outputRootId, relativePath: outcome.outputRelativePath });
  }
  candidates.push(input.item, {
    rootId: input.outputRoot.id,
    relativePath: join(input.failedOutputFolder.trim(), basename(input.item.relativePath)).replaceAll("\\", "/"),
  });
  for (const candidate of candidates) {
    const root =
      candidate.rootId === input.outputRoot.id ? input.outputRoot : await input.resolveRoot(candidate.rootId);
    const candidatePath = resolveRootRelativePath(root, candidate.relativePath);
    const exists = await stat(candidatePath)
      .then((value) => value.isFile())
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (!exists) continue;
    return {
      sourcePath: candidatePath,
      executionSource: candidate,
      outputBaseDirectory: resolveRootRelativePath(input.outputRoot, input.outputRelativeDirectory),
    };
  }
  throw new Error(`Retry source is missing: ${sourcePath}`);
};

export const preflightScrapeRetry = async (input: {
  manifest: {
    rootId: string;
    requestedOutputRootId: string | null;
    requestedOutputRelativeDirectory: string | null;
    executionMode: "single" | "batch";
    items: readonly (RootFileRef & { id: string })[];
    outcomes: readonly {
      itemId: string;
      outcome: string;
      outputRootId: string | null;
      outputRelativePath: string | null;
    }[];
  };
  itemIds?: readonly string[];
  configuration: Configuration;
  resolveRoot(id: string): Promise<Pick<MediaRoot, "id" | "hostPath">>;
}): Promise<void> => {
  const { manifest, configuration } = input;
  const latestOutcomeByItemId = new Map(manifest.outcomes.map((outcome) => [outcome.itemId, outcome]));
  const items = manifest.items.filter((item) => {
    if (input.itemIds) return input.itemIds.includes(item.id);
    const outcome = latestOutcomeByItemId.get(item.id)?.outcome;
    return outcome === "failed" || outcome === "skipped";
  });
  const outputRoot = await input.resolveRoot(manifest.requestedOutputRootId ?? manifest.rootId);
  const files = await Promise.all(
    items.map((item) =>
      resolveScrapeRetry({
        item,
        retrying: true,
        latestOutcome: latestOutcomeByItemId.get(item.id),
        outputRoot,
        outputRelativeDirectory: manifest.requestedOutputRelativeDirectory ?? "",
        failedOutputFolder: configuration.paths.failedOutputFolder,
        resolveRoot: input.resolveRoot,
      }),
    ),
  );
  await preflightScrapeTask({
    files,
    executionMode: manifest.executionMode,
    configuration: {
      ...configuration,
      paths: {
        ...configuration.paths,
        mediaPath: outputRoot.hostPath,
        ...(manifest.requestedOutputRootId
          ? { successOutputFolder: manifest.requestedOutputRelativeDirectory ?? "" }
          : {}),
      },
    },
  });
};
