import { resolveRootRelativePath } from "@mdcz/media-store";
import { parseWireRelativePath, type RootFileRef } from "@mdcz/shared/mediaRef";
import { PublicationConflictError } from "./conflicts";
import type {
  PublicationFileSystem,
  PublicationJournalManifestObsolete,
  PublicationMove,
  PublicationObsoleteObservation,
  PublicationPlan,
  PublishMediaOptions,
} from "./types";

export type ObservedPublicationFile =
  | { path: string; exists: false }
  | { path: string; exists: true; size: number; mtimeMs: number; isFile: boolean };

export interface ResolvedPublicationPlan {
  roots: Map<string, Awaited<ReturnType<PublishMediaOptions<unknown>["resolveRoot"]>>>;
  resolve(ref: RootFileRef): string;
  observed: ObservedPublicationFile[];
}

const refKey = (ref: RootFileRef): string => `${ref.rootId}\0${parseWireRelativePath(ref.relativePath)}`;

const refLabel = (ref: RootFileRef): string => `${ref.rootId}:${ref.relativePath}`;

export const planMoves = (plan: PublicationPlan): PublicationMove[] => [
  ...(plan.videos ?? []),
  ...(plan.sidecars ?? []),
];

export const planRefs = (plan: PublicationPlan): RootFileRef[] => [
  ...planMoves(plan).flatMap((move) => [move.source, move.target]),
  ...plan.artifacts.map(({ target }) => target),
  ...plan.assets.flatMap((asset) => (asset.type === "local" ? [asset.file] : [])),
  ...plan.obsolete,
];

export const observePublicationFile = async (
  fileSystem: PublicationFileSystem,
  filePath: string,
): Promise<ObservedPublicationFile> => {
  try {
    const stats = await fileSystem.stat(filePath);
    return { path: filePath, exists: true, size: stats.size, mtimeMs: stats.mtimeMs, isFile: stats.isFile() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: filePath, exists: false };
    throw error;
  }
};

export const publicationFilesMatch = (previous: ObservedPublicationFile, current: ObservedPublicationFile): boolean => {
  if (!previous.exists && !current.exists) return true;
  return (
    previous.exists === current.exists &&
    previous.exists &&
    current.exists &&
    current.size === previous.size &&
    current.mtimeMs === previous.mtimeMs &&
    current.isFile === previous.isFile
  );
};

export const assertPublicationFileUnchanged = (
  previous: ObservedPublicationFile,
  current: ObservedPublicationFile,
): void => {
  if (!publicationFilesMatch(previous, current)) {
    throw new Error(`Publication path changed before mutation: ${previous.path}`);
  }
};

export const toObsoleteObservation = (file: ObservedPublicationFile): PublicationObsoleteObservation =>
  file.exists ? { exists: true, size: file.size, mtimeMs: file.mtimeMs, isFile: file.isFile } : { exists: false };

export const removeCommittedObsoleteFiles = async (
  fileSystem: PublicationFileSystem,
  obsolete: readonly PublicationJournalManifestObsolete[],
  resolve: (rootId: string, relativePath: string) => string | Promise<string>,
): Promise<RootFileRef[]> => {
  const retained: RootFileRef[] = [];
  for (const ref of obsolete) {
    const obsoletePath = await resolve(ref.rootId, ref.relativePath);
    const current = await observePublicationFile(fileSystem, obsoletePath);
    if (!current.exists) continue;
    const expected: ObservedPublicationFile = ref.observed.exists
      ? {
          path: obsoletePath,
          exists: true,
          size: ref.observed.size,
          mtimeMs: ref.observed.mtimeMs,
          isFile: ref.observed.isFile,
        }
      : { path: obsoletePath, exists: false };
    if (publicationFilesMatch(expected, current)) {
      await fileSystem.rm(obsoletePath, { force: true });
      continue;
    }
    retained.push({ rootId: ref.rootId, relativePath: ref.relativePath });
  }
  return retained;
};

export const preflightPublication = async (
  plan: PublicationPlan,
  options: Pick<PublishMediaOptions<unknown>, "resolveRoot">,
  fileSystem: PublicationFileSystem,
  previous?: readonly ObservedPublicationFile[],
): Promise<ResolvedPublicationPlan> => {
  if (!plan.operationId.trim()) throw new Error("Publication operation ID is required");
  const refs = planRefs(plan);
  const rootIds = [...new Set(refs.map((ref) => ref.rootId))];
  const roots = new Map(
    await Promise.all(rootIds.map(async (rootId) => [rootId, await options.resolveRoot(rootId)] as const)),
  );
  const resolve = (ref: RootFileRef): string => {
    const root = roots.get(ref.rootId);
    if (!root) throw new Error(`Publication root not resolved: ${ref.rootId}`);
    return resolveRootRelativePath(root, parseWireRelativePath(ref.relativePath));
  };
  for (const fact of previous ?? []) {
    const current = await observePublicationFile(fileSystem, fact.path);
    if (!fact.exists && current.exists) {
      const video = plan.videos?.find((video) => resolve(video.target) === fact.path);
      if (video) throw new PublicationConflictError(resolve(video.source), fact.path);
    }
    assertPublicationFileUnchanged(fact, current);
  }
  const moves = planMoves(plan);
  const targets = [...moves.map((move) => move.target), ...plan.artifacts.map(({ target }) => target)];
  const targetKeys = targets.map(refKey);
  if (new Set(targetKeys).size !== targetKeys.length) throw new Error("Publication target collision within plan");
  const replacing = new Set((plan.replaceExistingTargets ?? []).map(refKey));
  const observedByPath = new Map<string, ObservedPublicationFile>();
  const record = async (filePath: string): Promise<ObservedPublicationFile> => {
    const existing = observedByPath.get(filePath);
    if (existing) return existing;
    const fact = await observePublicationFile(fileSystem, filePath);
    observedByPath.set(filePath, fact);
    return fact;
  };

  for (const move of moves) {
    if (!Number.isSafeInteger(move.size) || move.size < 0) throw new Error("Invalid publication move size");
    const sourcePath = resolve(move.source);
    const targetPath = resolve(move.target);
    const source = await record(sourcePath);
    const target = await record(targetPath);
    if (plan.videos?.includes(move) && sourcePath !== targetPath && source.exists && target.exists) {
      throw new PublicationConflictError(sourcePath, targetPath);
    }
    if (target.exists && !target.isFile) throw new Error(`Publication target is not a file: ${targetPath}`);
    if (move.shared && target.exists && !source.exists) {
      plan.sidecars = plan.sidecars?.filter((candidate) => candidate !== move);
      continue;
    }
    if (source.exists) {
      if (!source.isFile || source.size !== move.size) {
        throw new Error(`Publication source size mismatch: ${refLabel(move.source)}`);
      }
    } else {
      throw new Error(`Publication source is missing: ${refLabel(move.source)}`);
    }
    if (
      !plan.videos?.includes(move) &&
      sourcePath !== targetPath &&
      target.exists &&
      !replacing.has(refKey(move.target))
    )
      throw new Error(`Publication sidecar replacement was not planned: ${refLabel(move.target)}`);
  }

  for (const artifact of plan.artifacts) {
    const targetPath = resolve(artifact.target);
    const existing = await record(targetPath);
    if (!existing.exists) continue;
    if (!existing.isFile) throw new Error(`Publication target is not a file: ${targetPath}`);
    if (artifact.content.kind === "download") {
      throw new Error(`Publication target already exists: ${refLabel(artifact.target)}`);
    }
    if (artifact.content.kind === "file") {
      if (!replacing.has(refKey(artifact.target)))
        throw new Error(`Publication artifact replacement was not planned: ${refLabel(artifact.target)}`);
      continue;
    }
    const expected = Buffer.from(artifact.content.data);
    const actual = await fileSystem.readFile(targetPath);
    if (!actual.equals(expected) && !replacing.has(refKey(artifact.target)))
      throw new Error(`Publication artifact replacement was not planned: ${refLabel(artifact.target)}`);
  }

  for (const ref of plan.obsolete) {
    await record(resolve(ref));
  }
  const plannedTargets = new Set(targets.map((ref) => resolve(ref)));
  for (const asset of plan.assets) {
    if (asset.type !== "local") continue;
    const assetPath = resolve(asset.file);
    if (plannedTargets.has(assetPath)) continue;
    const fact = await record(assetPath);
    if (!fact.exists || !fact.isFile) throw new Error(`Publication asset is missing or not a file: ${assetPath}`);
  }

  return { roots, resolve, observed: [...observedByPath.values()] };
};
