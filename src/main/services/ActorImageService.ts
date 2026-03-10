import { copyFile, link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { CachedAsyncResolver } from "@main/utils/CachedAsyncResolver";
import { pathExists } from "@main/utils/file";
import { sanitizePathSegment } from "@main/utils/path";
import type { ActorProfile } from "@shared/types";
import PQueue from "p-queue";

const CACHE_DIR_NAME = ".cache";
const INDEX_FILE_NAME = "index.json";
const QUEUE_FILE_NAME = "queue.json";
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

type ActorImageIndexEntry = {
  normalizedName: string;
  displayName: string;
  aliases: string[];
  publicFileName?: string;
  blobRelativePath?: string;
  source?: string;
  remoteUrl?: string;
  locked: boolean;
  updatedAt: string;
};

type ActorImageIndex = {
  version: 1;
  actors: Record<string, ActorImageIndexEntry>;
};

type ActorImageQueueEntry = {
  normalizedName: string;
  displayName: string;
  aliases: string[];
  batchNfoPaths: string[];
  updatedAt: string;
};

type ActorImageQueue = {
  version: 1;
  pending: Record<string, ActorImageQueueEntry>;
};

type ActorImageLayout = {
  root: string;
  indexPath: string;
  queuePath: string;
  blobsDir: string;
};

export interface EnqueueActorImageInput {
  name: string;
  aliases?: string[];
  batchNfoPath?: string;
}

const createEmptyIndex = (): ActorImageIndex => ({
  version: 1,
  actors: {},
});

const createEmptyQueue = (): ActorImageQueue => ({
  version: 1,
  pending: {},
});

const buildPublicFileName = (displayName: string, extension: string): string => {
  const sanitized = sanitizePathSegment(displayName) || "actor";
  return `${sanitized}${extension}`;
};

export class ActorImageService {
  private readonly logger = loggerService.getLogger("ActorImageService");
  private readonly mutexByRoot = new Map<string, PQueue>();
  private readonly layoutResolver = new CachedAsyncResolver<string, ActorImageLayout>();

  private getMutex(root: string): PQueue {
    let mutex = this.mutexByRoot.get(root);
    if (!mutex) {
      mutex = new PQueue({ concurrency: 1 });
      this.mutexByRoot.set(root, mutex);
    }
    return mutex;
  }

  async resolveLocalImage(configuration: Configuration, actorNames: string[]): Promise<string | undefined> {
    const root = configuration.personSync.actorPhotoFolder.trim();
    if (!root) return undefined;
    return this.getMutex(root).add(() => this.resolveLocalImageUnsafe(configuration, actorNames));
  }

  private async resolveLocalImageUnsafe(
    configuration: Configuration,
    actorNames: string[],
  ): Promise<string | undefined> {
    const layout = await this.ensureLayout(configuration.personSync.actorPhotoFolder.trim());
    if (!layout) {
      return undefined;
    }

    const names = toUniqueActorNames(actorNames);
    if (names.length === 0) {
      return undefined;
    }

    const index = await this.readIndex(layout.indexPath);
    const existing = this.findEntry(index, names);
    const restoredPath = await this.resolveExistingEntry(layout, existing);
    if (restoredPath) {
      return restoredPath;
    }

    const discoveredPath = await this.findPublicImage(layout.root, names);
    if (!discoveredPath) {
      return undefined;
    }

    const nextEntry = this.createOrMergeEntry(existing, names, {
      publicFileName: basename(discoveredPath),
      locked: true,
      source: existing?.source ?? "local",
      remoteUrl: existing?.remoteUrl,
      blobRelativePath: existing?.blobRelativePath,
    });
    index.actors[nextEntry.normalizedName] = nextEntry;
    await this.writeIndex(layout.indexPath, index);
    return discoveredPath;
  }

  async enqueue(configuration: Configuration, input: EnqueueActorImageInput): Promise<void> {
    const root = configuration.personSync.actorPhotoFolder.trim();
    if (!root) return;
    await this.getMutex(root).add(() => this.enqueueUnsafe(configuration, input));
  }

  private async enqueueUnsafe(configuration: Configuration, input: EnqueueActorImageInput): Promise<void> {
    const layout = await this.ensureLayout(configuration.personSync.actorPhotoFolder.trim());
    if (!layout) {
      return;
    }

    const names = toUniqueActorNames([input.name, ...(input.aliases ?? [])]);
    if (names.length === 0) {
      return;
    }

    const normalized = normalizeActorName(names[0]);
    const queue = await this.readQueue(layout.queuePath);
    const existing = queue.pending[normalized];
    const batchNfoPaths = Array.from(
      new Set([...(existing?.batchNfoPaths ?? []), ...(input.batchNfoPath ? [input.batchNfoPath] : [])]),
    );

    queue.pending[normalized] = {
      normalizedName: normalized,
      displayName: existing?.displayName ?? names[0],
      aliases: toUniqueActorNames([...(existing?.aliases ?? []), ...names.slice(1)]),
      batchNfoPaths,
      updatedAt: new Date().toISOString(),
    };

    await this.writeQueue(layout.queuePath, queue);
  }

  async materializeForMovie(movieDir: string, actorName: string, sourcePath: string): Promise<string | undefined> {
    if (!movieDir.trim() || !sourcePath.trim() || !(await pathExists(sourcePath))) {
      return undefined;
    }

    const extension = extname(sourcePath).toLowerCase() || ".jpg";
    const actorsDir = join(movieDir, ".actors");
    const targetFileName = buildPublicFileName(actorName, extension);
    const targetPath = join(actorsDir, targetFileName);

    await mkdir(actorsDir, { recursive: true });
    await rm(targetPath, { force: true });

    try {
      await link(sourcePath, targetPath);
    } catch {
      try {
        await symlink(relative(dirname(targetPath), sourcePath), targetPath);
      } catch {
        await copyFile(sourcePath, targetPath);
      }
    }

    return relative(movieDir, targetPath).replaceAll("\\", "/");
  }

  async prepareActorProfilesForMovie(
    configuration: Configuration,
    input: {
      movieDir: string;
      nfoPath: string;
      actors: string[];
      actorProfiles?: ActorProfile[];
    },
  ): Promise<ActorProfile[] | undefined> {
    const profileByName = new Map<string, ActorProfile>();
    for (const profile of input.actorProfiles ?? []) {
      const normalized = normalizeActorName(profile.name);
      if (normalized) {
        profileByName.set(normalized, profile);
      }
    }

    const preparedProfiles: ActorProfile[] = [];

    const seenActorNames = new Set<string>();
    for (const rawActorName of input.actors) {
      const actorName = rawActorName.trim();
      const normalized = normalizeActorName(actorName);
      if (!normalized || seenActorNames.has(normalized)) {
        continue;
      }
      seenActorNames.add(normalized);

      const existingProfile = profileByName.get(normalized);
      const lookupNames = toUniqueActorNames([actorName, existingProfile?.name, ...(existingProfile?.aliases ?? [])]);
      const localImagePath = await this.resolveLocalImage(configuration, lookupNames);

      if (!localImagePath) {
        await this.enqueue(configuration, {
          name: actorName,
          aliases: lookupNames.slice(1),
          batchNfoPath: input.nfoPath,
        });
        preparedProfiles.push({
          ...existingProfile,
          name: actorName,
          photo_url: undefined,
        });
        continue;
      }

      const relativeThumbPath = await this.materializeForMovie(input.movieDir, actorName, localImagePath);
      preparedProfiles.push({
        ...existingProfile,
        name: actorName,
        photo_url: relativeThumbPath,
      });
    }

    return preparedProfiles.length > 0 ? preparedProfiles : undefined;
  }

  private ensureLayout(root: string): Promise<ActorImageLayout | null> {
    if (!root) return Promise.resolve(null);
    return this.layoutResolver.resolve(root, (key) => this.initLayout(key));
  }

  private async initLayout(root: string): Promise<ActorImageLayout> {
    const cacheDir = join(root, CACHE_DIR_NAME);
    const indexPath = join(cacheDir, INDEX_FILE_NAME);
    const queuePath = join(cacheDir, QUEUE_FILE_NAME);
    const blobsDir = join(root, ".cache", "blobs", "sha256");

    await mkdir(blobsDir, { recursive: true });

    if (!(await pathExists(indexPath))) {
      await this.writeIndex(indexPath, createEmptyIndex());
    }
    if (!(await pathExists(queuePath))) {
      await this.writeQueue(queuePath, createEmptyQueue());
    }

    return { root, indexPath, queuePath, blobsDir };
  }

  private async readIndex(indexPath: string): Promise<ActorImageIndex> {
    return this.readJson(indexPath, createEmptyIndex());
  }

  private async writeIndex(indexPath: string, index: ActorImageIndex): Promise<void> {
    await this.writeJson(indexPath, index);
  }

  private async readQueue(queuePath: string): Promise<ActorImageQueue> {
    return this.readJson(queuePath, createEmptyQueue());
  }

  private async writeQueue(queuePath: string, queue: ActorImageQueue): Promise<void> {
    await this.writeJson(queuePath, queue);
  }

  private async readJson<T>(filePath: string, fallback: T): Promise<T> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        await this.writeJson(filePath, fallback);
        return fallback;
      }
      throw error;
    }

    try {
      return JSON.parse(raw) as T;
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : String(parseError);
      this.logger.warn(`Corrupt JSON at ${filePath}, returning empty state (file preserved): ${message}`);
      return fallback;
    }
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private findEntry(index: ActorImageIndex, names: string[]): ActorImageIndexEntry | undefined {
    const normalizedNames = names.map((name) => normalizeActorName(name)).filter((name) => name.length > 0);
    for (const normalizedName of normalizedNames) {
      const direct = index.actors[normalizedName];
      if (direct) {
        return direct;
      }
    }

    const normalizedSet = new Set(normalizedNames);
    for (const entry of Object.values(index.actors)) {
      if (normalizedSet.has(entry.normalizedName)) {
        return entry;
      }

      if (entry.aliases.some((alias) => normalizedSet.has(normalizeActorName(alias)))) {
        return entry;
      }
    }

    return undefined;
  }

  private async resolveExistingEntry(
    layout: ActorImageLayout,
    entry: ActorImageIndexEntry | undefined,
  ): Promise<string | undefined> {
    if (!entry?.publicFileName) {
      return undefined;
    }

    const publicPath = join(layout.root, entry.publicFileName);
    if (await pathExists(publicPath)) {
      return publicPath;
    }

    if (!entry.blobRelativePath || entry.locked) {
      return undefined;
    }

    const blobPath = join(layout.root, entry.blobRelativePath);
    if (!(await pathExists(blobPath))) {
      return undefined;
    }

    await copyFile(blobPath, publicPath);
    return publicPath;
  }

  private async findPublicImage(root: string, names: string[]): Promise<string | undefined> {
    const candidates = Array.from(
      new Set(
        names.flatMap((name) => {
          const trimmed = name.trim();
          const sanitized = sanitizePathSegment(trimmed);
          return [trimmed, trimmed.replaceAll(" ", ""), sanitized, sanitized.replaceAll(" ", "")]
            .filter((value) => value.length > 0)
            .flatMap((baseName) => PHOTO_EXTENSIONS.map((extension) => join(root, `${baseName}${extension}`)));
        }),
      ),
    );

    for (const candidate of candidates) {
      if (await pathExists(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private createOrMergeEntry(
    existing: ActorImageIndexEntry | undefined,
    names: string[],
    next: Pick<ActorImageIndexEntry, "publicFileName" | "blobRelativePath" | "locked" | "source" | "remoteUrl">,
  ): ActorImageIndexEntry {
    const canonicalName = existing?.displayName ?? names[0] ?? "";
    const normalizedName = existing?.normalizedName ?? normalizeActorName(canonicalName);
    const aliases = toUniqueActorNames([...(existing?.aliases ?? []), ...names.slice(1)]).filter(
      (alias) => normalizeActorName(alias) !== normalizedName,
    );

    return {
      normalizedName,
      displayName: canonicalName,
      aliases,
      publicFileName: next.publicFileName ?? existing?.publicFileName,
      blobRelativePath: next.blobRelativePath ?? existing?.blobRelativePath,
      source: next.source ?? existing?.source,
      remoteUrl: next.remoteUrl ?? existing?.remoteUrl,
      locked: next.locked,
      updatedAt: new Date().toISOString(),
    };
  }
}
