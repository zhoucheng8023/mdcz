import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  PublicationConflictChoice,
  PublicationConflictResolution,
  PublicationConflictSnapshot,
} from "@mdcz/shared/publicationConflicts";
import { assertPublicationFileUnchanged, type ObservedPublicationFile, observePublicationFile } from "./preflight";
import type { PublicationFileSystem, PublicationPlan } from "./types";

export class PublicationConflictError extends Error {
  constructor(
    readonly snapshot: Omit<PublicationConflictSnapshot, "taskId" | "itemId">,
    readonly applyChoice: (choice: PublicationConflictChoice) => Promise<void>,
  ) {
    super(`Publication target already exists: ${snapshot.targetPath}`);
  }
}

export const createPublicationConflict = async (input: {
  plan: PublicationPlan;
  target: RootFileRef;
  source?: RootFileRef;
  sourceSize: number;
  resolve(ref: RootFileRef): string;
  fileSystem: PublicationFileSystem;
}): Promise<PublicationConflictError> => {
  const { plan, target, fileSystem } = input;
  const targetPath = input.resolve(target);
  const sourcePath = input.source ? input.resolve(input.source) : null;
  const targetFact = await observePublicationFile(fileSystem, targetPath);
  if (!targetFact.exists || !targetFact.isFile) throw new Error(`Publication target is not a file: ${targetPath}`);
  const sourceFact = sourcePath ? await observePublicationFile(fileSystem, sourcePath) : undefined;
  const extension = extname(targetPath);
  let candidate: string;
  for (let index = 1; ; index += 1) {
    candidate = join(dirname(targetPath), `${basename(targetPath, extension)} (${index})${extension}`);
    if (!(await observePublicationFile(fileSystem, candidate)).exists) break;
  }
  const keepBothPath = candidate;
  const facts = [targetFact, ...(sourceFact ? [sourceFact] : [])];
  return new PublicationConflictError(
    {
      id: randomUUID(),
      operationId: plan.operationId,
      sourcePath,
      targetPath,
      sourceSize: input.sourceSize,
      targetSize: targetFact.size,
      sourceModifiedAt: sourceFact?.exists ? sourceFact.mtimeMs : null,
      targetModifiedAt: targetFact.mtimeMs,
      keepBothPath,
    },
    async (choice) => {
      for (const fact of facts)
        assertPublicationFileUnchanged(fact, await observePublicationFile(fileSystem, fact.path));
      const oldRef = { ...target };
      const same = (ref: RootFileRef) => ref.rootId === oldRef.rootId && ref.relativePath === oldRef.relativePath;
      if (choice === "keep_new") {
        plan.replaceExistingTargets = [...(plan.replaceExistingTargets ?? []), oldRef];
      } else if (choice === "keep_both") {
        const vacant: ObservedPublicationFile = { path: keepBothPath, exists: false };
        assertPublicationFileUnchanged(vacant, await observePublicationFile(fileSystem, keepBothPath));
        const newRef = {
          rootId: target.rootId,
          relativePath: join(dirname(target.relativePath), basename(keepBothPath)).replaceAll("\\", "/"),
        };
        plan.targetChanges = [...(plan.targetChanges ?? []), { from: oldRef, to: newRef }];
        for (const asset of plan.assets) if (asset.type === "local" && same(asset.file)) asset.file = { ...newRef };
        Object.assign(target, newRef);
        facts.push(vacant);
      } else {
        const move = [plan.video, ...(plan.sidecars ?? [])].find((move) => move && same(move.target));
        if (move) {
          plan.obsolete.push({ ...move.source });
          move.source = oldRef;
          move.size = targetFact.size;
          move.content = undefined;
        } else {
          plan.artifacts = plan.artifacts.filter((artifact) => !same(artifact.target));
        }
      }
      plan.expectedFiles = [...(plan.expectedFiles ?? []), ...facts];
    },
  );
};

const pending = new Map<
  string,
  {
    snapshot: PublicationConflictSnapshot;
    retry: () => Promise<void>;
    error: PublicationConflictError;
    resolving: boolean;
  }
>();

export const publicationConflicts = {
  list: (): PublicationConflictSnapshot[] => [...pending.values()].map(({ snapshot }) => ({ ...snapshot })),
  register(taskId: string, itemId: string, error: PublicationConflictError, retry: () => Promise<void>): void {
    this.cancelItem(taskId, itemId);
    pending.set(error.snapshot.id, { snapshot: { ...error.snapshot, taskId, itemId }, error, retry, resolving: false });
  },
  cancelItem(taskId: string, itemId: string): void {
    for (const [id, entry] of pending)
      if (entry.snapshot.taskId === taskId && entry.snapshot.itemId === itemId) pending.delete(id);
  },
  cancelTask(taskId: string): void {
    for (const [id, entry] of pending) if (entry.snapshot.taskId === taskId) pending.delete(id);
  },
  async resolve(input: PublicationConflictResolution): Promise<void> {
    const entry = pending.get(input.id);
    if (!entry || entry.resolving) throw new Error("文件冲突已变化或正在处理，请刷新后重试");
    entry.resolving = true;
    try {
      await entry.error.applyChoice(input.choice);
      if (pending.get(input.id) !== entry) throw new Error("任务已停止，选择已失效");
      pending.delete(input.id);
      await entry.retry();
    } catch (error) {
      entry.resolving = false;
      throw error;
    }
  },
};
