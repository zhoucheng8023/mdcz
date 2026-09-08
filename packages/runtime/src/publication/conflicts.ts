import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join } from "node:path";
import type { RootFileRef } from "@mdcz/shared/mediaRef";
import type {
  PublicationConflictChoice,
  PublicationConflictResolution,
  PublicationConflictSnapshot,
} from "@mdcz/shared/publicationConflicts";
import { SUBTITLE_EXTENSIONS } from "../scrape/utils/subtitles";
import { assertPublicationFileUnchanged, type ObservedPublicationFile, observePublicationFile } from "./preflight";
import { planVideoTargetChanges, retargetPublicationVideo } from "./retargetVideo";
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
  source: RootFileRef;
  sourceSize: number;
  resolve(ref: RootFileRef): string;
  fileSystem: PublicationFileSystem;
}): Promise<PublicationConflictError> => {
  const { plan, target, fileSystem } = input;
  const video = plan.videos?.find((candidate) => candidate.target === target);
  if (!video) throw new Error("Only the main video supports interactive publication conflicts");
  const targetPath = input.resolve(target);
  const sourcePath = input.resolve(input.source);
  const targetFact = await observePublicationFile(fileSystem, targetPath);
  if (!targetFact.exists || !targetFact.isFile) throw new Error(`Publication target is not a file: ${targetPath}`);
  const sourceFact = await observePublicationFile(fileSystem, sourcePath);
  const extension = extname(targetPath);
  let candidate: string;
  let changes: ReturnType<typeof planVideoTargetChanges>;
  let vacantTargets: ObservedPublicationFile[];
  for (let index = 1; ; index += 1) {
    candidate = join(dirname(targetPath), `${basename(targetPath, extension)} (${index})${extension}`);
    changes = planVideoTargetChanges(video, {
      rootId: target.rootId,
      relativePath: join(dirname(target.relativePath), basename(candidate)).replaceAll("\\", "/"),
    });
    vacantTargets = await Promise.all(changes.map(({ to }) => observePublicationFile(fileSystem, input.resolve(to))));
    if (vacantTargets.every((fact) => !fact.exists)) break;
  }
  const keepBothPath = candidate;
  const facts = [targetFact, sourceFact];
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
      if (choice === "keep_new") {
        plan.replaceExistingTargets = [...(plan.replaceExistingTargets ?? []), oldRef];
      } else if (choice === "keep_both") {
        for (const vacant of vacantTargets)
          assertPublicationFileUnchanged(vacant, await observePublicationFile(fileSystem, vacant.path));
        retargetPublicationVideo(plan, video, changes, input.resolve);
        facts.push(...vacantTargets);
      } else {
        plan.obsolete.push({ ...video.source });
        video.source = oldRef;
        video.size = targetFact.size;
        video.content = undefined;
        const discardedSubtitleTargets = new Set(
          (video.nameTargets ?? [])
            .filter((target) => SUBTITLE_EXTENSIONS.has(extname(target.relativePath).toLowerCase()))
            .map((target) => `${target.rootId}\0${target.relativePath}`),
        );
        plan.sidecars = plan.sidecars?.filter(
          (sidecar) => !discardedSubtitleTargets.has(`${sidecar.target.rootId}\0${sidecar.target.relativePath}`),
        );
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

export const publishWithConflictResolution = (operationId: string, publish: () => Promise<void>): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const attempt = async (): Promise<void> => {
      try {
        await publish();
        resolve();
      } catch (error) {
        if (!(error instanceof PublicationConflictError)) {
          reject(error);
          return;
        }
        publicationConflicts.register(operationId, operationId, error, attempt);
      }
    };
    void attempt();
  });
