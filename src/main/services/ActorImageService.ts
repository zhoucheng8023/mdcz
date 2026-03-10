import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative } from "node:path";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import { normalizeActorName, toUniqueActorNames } from "@main/utils/actor";
import { toArray } from "@main/utils/common";
import { pathExists } from "@main/utils/file";
import { sanitizePathSegment } from "@main/utils/path";
import type { ActorProfile } from "@shared/types";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

const CACHE_DIR_NAME = ".cache";
const INDEX_FILE_NAME = "index.json";
const QUEUE_FILE_NAME = "queue.json";
const BLOBS_SEGMENTS = [CACHE_DIR_NAME, "blobs", "sha256"] as const;
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

const nfoXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  commentPropName: "#comment",
});

const nfoXmlBuilder = new XMLBuilder({
  attributeNamePrefix: "@_",
  ignoreAttributes: false,
  format: true,
  commentPropName: "#comment",
});

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

export interface StoreRemoteActorImageInput extends EnqueueActorImageInput {
  bytes: Uint8Array;
  source: string;
  remoteUrl?: string;
  contentType?: string;
}

export interface StoreRemoteImageResult {
  publicPath: string;
  batchNfoPaths: string[];
}

export interface BackfillBatchInput {
  actorName: string;
  aliases?: string[];
  imagePath: string;
  nfoPaths: string[];
}

const createEmptyIndex = (): ActorImageIndex => ({
  version: 1,
  actors: {},
});

const createEmptyQueue = (): ActorImageQueue => ({
  version: 1,
  pending: {},
});

const normalizeNames = (names: ReadonlyArray<string | undefined>): string[] => {
  return toUniqueActorNames(names);
};

const buildBlobRelativePath = (hash: string, extension: string): string => {
  return join(...BLOBS_SEGMENTS, hash.slice(0, 2), `${hash}${extension}`);
};

const normalizeImageExtension = (remoteUrl: string | undefined, contentType: string | undefined): string => {
  const extFromUrl = (() => {
    if (!remoteUrl) {
      return undefined;
    }

    try {
      const parsed = new URL(remoteUrl);
      return extname(parsed.pathname).toLowerCase();
    } catch {
      return extname(remoteUrl).toLowerCase();
    }
  })();

  if (extFromUrl && PHOTO_EXTENSIONS.includes(extFromUrl as (typeof PHOTO_EXTENSIONS)[number])) {
    return extFromUrl;
  }

  switch (contentType?.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
};

const buildPublicFileName = (displayName: string, extension: string, fallbackKey: string): string => {
  const sanitized = sanitizePathSegment(displayName) || fallbackKey || "actor";
  return `${sanitized}${extension}`;
};

const normalizeActorKey = (value: string): string => normalizeActorName(value);

export class ActorImageService {
  private readonly logger = loggerService.getLogger("ActorImageService");

  async resolveLocalImage(configuration: Configuration, actorNames: string[]): Promise<string | undefined> {
    const layout = await this.ensureLayout(configuration.server.actorPhotoFolder.trim());
    if (!layout) {
      return undefined;
    }

    const names = normalizeNames(actorNames);
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
    const layout = await this.ensureLayout(configuration.server.actorPhotoFolder.trim());
    if (!layout) {
      return;
    }

    const names = normalizeNames([input.name, ...(input.aliases ?? [])]);
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
      aliases: normalizeNames([...(existing?.aliases ?? []), ...names.slice(1)]),
      batchNfoPaths,
      updatedAt: new Date().toISOString(),
    };

    await this.writeQueue(layout.queuePath, queue);
  }

  async storeRemoteImage(
    configuration: Configuration,
    input: StoreRemoteActorImageInput,
  ): Promise<StoreRemoteImageResult | undefined> {
    const layout = await this.ensureLayout(configuration.server.actorPhotoFolder.trim());
    if (!layout) {
      return undefined;
    }

    const names = normalizeNames([input.name, ...(input.aliases ?? [])]);
    if (names.length === 0) {
      return undefined;
    }

    const index = await this.readIndex(layout.indexPath);
    const queue = await this.readQueue(layout.queuePath);
    const existing = this.findEntry(index, names);
    const normalized = existing?.normalizedName ?? normalizeActorName(names[0]);
    const extension = normalizeImageExtension(input.remoteUrl, input.contentType);
    const hash = createHash("sha256").update(input.bytes).digest("hex");
    const blobRelativePath = buildBlobRelativePath(hash, extension);
    const blobPath = join(layout.root, blobRelativePath);
    const publicFileName = existing?.publicFileName ?? buildPublicFileName(names[0], extension, normalized);
    const publicPath = join(layout.root, publicFileName);

    await mkdir(join(layout.blobsDir, hash.slice(0, 2)), { recursive: true });
    if (!(await pathExists(blobPath))) {
      await writeFile(blobPath, Buffer.from(input.bytes));
    }

    const keepExistingPublicFile = existing?.locked && (await pathExists(publicPath));
    if (!keepExistingPublicFile) {
      await copyFile(blobPath, publicPath);
    }

    const nextEntry = this.createOrMergeEntry(existing, names, {
      publicFileName,
      blobRelativePath,
      locked: existing?.locked ?? false,
      source: input.source,
      remoteUrl: input.remoteUrl,
    });
    index.actors[normalized] = {
      ...nextEntry,
      normalizedName: normalized,
    };

    const batchNfoPaths = queue.pending[normalized]?.batchNfoPaths ?? [];
    delete queue.pending[normalized];

    await Promise.all([this.writeIndex(layout.indexPath, index), this.writeQueue(layout.queuePath, queue)]);
    return { publicPath, batchNfoPaths };
  }

  async materializeForMovie(movieDir: string, actorName: string, sourcePath: string): Promise<string | undefined> {
    if (!movieDir.trim() || !sourcePath.trim() || !(await pathExists(sourcePath))) {
      return undefined;
    }

    const normalizedName = normalizeActorName(actorName);
    const extension = extname(sourcePath).toLowerCase() || ".jpg";
    const actorsDir = join(movieDir, ".actors");
    const targetFileName = buildPublicFileName(actorName, extension, normalizedName);
    const targetPath = join(actorsDir, targetFileName);

    await mkdir(actorsDir, { recursive: true });
    await rm(targetPath, { force: true });

    try {
      await link(sourcePath, targetPath);
    } catch {
      try {
        await symlink(sourcePath, targetPath);
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
      const normalized = normalizeActorKey(profile.name);
      if (normalized) {
        profileByName.set(normalized, profile);
      }
    }

    const preparedProfiles: ActorProfile[] = [];

    const seenActorNames = new Set<string>();
    for (const [index, rawActorName] of input.actors.entries()) {
      const actorName = rawActorName.trim();
      const normalized = normalizeActorKey(actorName);
      if (!normalized || seenActorNames.has(normalized)) {
        continue;
      }
      seenActorNames.add(normalized);

      const fallbackProfile = input.actorProfiles?.[index];
      const existingProfile = profileByName.get(normalized) ?? fallbackProfile;
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

  async backfillBatch(input: BackfillBatchInput): Promise<void> {
    const { actorName, aliases, imagePath, nfoPaths } = input;
    if (!imagePath || nfoPaths.length === 0 || !(await pathExists(imagePath))) {
      return;
    }

    const lookupNames = new Set(
      [actorName, ...(aliases ?? [])].map((n) => normalizeActorName(n)).filter((n) => n.length > 0),
    );
    if (lookupNames.size === 0) {
      return;
    }

    for (const nfoPath of nfoPaths) {
      try {
        await this.patchActorThumbInNfo(nfoPath, lookupNames, actorName, imagePath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`backfillBatch: failed to patch ${nfoPath}: ${message}`);
      }
    }
  }

  private async patchActorThumbInNfo(
    nfoPath: string,
    normalizedNames: Set<string>,
    displayName: string,
    imagePath: string,
  ): Promise<void> {
    if (!(await pathExists(nfoPath))) {
      return;
    }

    const xml = await readFile(nfoPath, "utf8");
    const root = nfoXmlParser.parse(xml) as Record<string, unknown>;
    const movieNode = root?.movie;
    if (!movieNode || typeof movieNode !== "object") {
      return;
    }

    const movie = movieNode as Record<string, unknown>;
    const actorNodes = toArray(movie.actor);
    if (actorNodes.length === 0) {
      return;
    }

    const movieDir = dirname(nfoPath);
    let patched = false;

    for (const node of actorNodes) {
      if (!node || typeof node !== "object") {
        continue;
      }

      const fields = node as Record<string, unknown>;
      const name = typeof fields.name === "string" ? fields.name.trim() : "";
      if (!name || !normalizedNames.has(normalizeActorName(name))) {
        continue;
      }

      const relativePath = await this.materializeForMovie(movieDir, displayName, imagePath);
      if (relativePath) {
        fields.thumb = relativePath;
        patched = true;
      }
    }

    if (patched) {
      const updatedXml = nfoXmlBuilder.build(root) as string;
      const hasDeclaration = xml.trimStart().startsWith("<?xml");
      const output =
        hasDeclaration && !updatedXml.startsWith("<?xml")
          ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${updatedXml}`
          : updatedXml;
      await writeFile(nfoPath, output, "utf8");
    }
  }

  private async ensureLayout(root: string): Promise<ActorImageLayout | null> {
    if (!root) {
      return null;
    }

    const cacheDir = join(root, CACHE_DIR_NAME);
    const indexPath = join(cacheDir, INDEX_FILE_NAME);
    const queuePath = join(cacheDir, QUEUE_FILE_NAME);
    const blobsDir = join(root, ...BLOBS_SEGMENTS);

    await mkdir(blobsDir, { recursive: true });

    if (!(await pathExists(indexPath))) {
      await this.writeIndex(indexPath, createEmptyIndex());
    }
    if (!(await pathExists(queuePath))) {
      await this.writeQueue(queuePath, createEmptyQueue());
    }

    return {
      root,
      indexPath,
      queuePath,
      blobsDir,
    };
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
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to read actor image state at ${filePath}, resetting it: ${message}`);
      await this.writeJson(filePath, fallback);
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
    const aliases = normalizeNames([...(existing?.aliases ?? []), ...names.slice(1)]).filter(
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
