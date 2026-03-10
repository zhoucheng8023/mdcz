import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { Website } from "@shared/enums";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-actor-image-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createConfig = (root: string) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    server: {
      ...defaultConfiguration.server,
      actorPhotoFolder: root,
    },
  });

describe("ActorImageService", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("creates cache skeleton and indexes manual root images during local resolve", async () => {
    const root = await createTempDir();
    const config = createConfig(root);
    const service = new ActorImageService();
    const manualPath = join(root, "Actor A.jpg");
    await writeFile(manualPath, "manual", "utf8");

    const resolved = await service.resolveLocalImage(config, ["Actor A"]);
    const index = JSON.parse(await readFile(join(root, ".cache", "index.json"), "utf8")) as {
      actors: Record<string, { publicFileName: string; locked: boolean; source: string }>;
    };
    const queue = JSON.parse(await readFile(join(root, ".cache", "queue.json"), "utf8")) as {
      pending: Record<string, unknown>;
    };

    expect(resolved).toBe(manualPath);
    expect(index.actors.actora).toMatchObject({
      publicFileName: "Actor A.jpg",
      locked: true,
      source: "local",
    });
    expect(queue.pending).toEqual({});
  });

  it("stores remote images into blob cache and publishes a root actor image", async () => {
    const root = await createTempDir();
    const config = createConfig(root);
    const service = new ActorImageService();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const result = await service.storeRemoteImage(config, {
      name: "Actor A",
      source: "official",
      remoteUrl: "https://img.example.com/actor-a.png",
      contentType: "image/png",
      bytes,
    });

    const index = JSON.parse(await readFile(join(root, ".cache", "index.json"), "utf8")) as {
      actors: Record<string, { publicFileName: string; blobRelativePath: string; source: string; locked: boolean }>;
    };
    const entry = index.actors.actora;

    expect(result?.publicPath).toBe(join(root, "Actor A.png"));
    expect(result?.batchNfoPaths).toEqual([]);
    expect(entry).toMatchObject({
      publicFileName: "Actor A.png",
      source: "official",
      locked: false,
    });
    expect(await readFile(join(root, entry.blobRelativePath))).toEqual(Buffer.from(bytes));
    expect(await readFile(join(root, "Actor A.png"))).toEqual(Buffer.from(bytes));
  });

  it("queues actor image requests and preserves batch NFO references", async () => {
    const root = await createTempDir();
    const config = createConfig(root);
    const service = new ActorImageService();
    const nfoPath = join(root, "Movie", "ABC-123.nfo");

    await service.enqueue(config, {
      name: "Actor A",
      aliases: ["Alias A"],
      batchNfoPath: nfoPath,
    });
    await service.enqueue(config, {
      name: "Actor A",
      batchNfoPath: nfoPath,
    });

    const queue = JSON.parse(await readFile(join(root, ".cache", "queue.json"), "utf8")) as {
      pending: Record<string, { displayName: string; aliases: string[]; batchNfoPaths: string[] }>;
    };

    expect(queue.pending.actora).toMatchObject({
      displayName: "Actor A",
      aliases: ["Alias A"],
      batchNfoPaths: [nfoPath],
    });
  });

  it("materializes cached actor images for movie NFOs and queues missing actors", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "Movie");
    const nfoPath = join(movieDir, "ABC-123.nfo");
    const config = createConfig(root);
    const service = new ActorImageService();
    const manualPath = join(root, "Actor A.jpg");

    await writeFile(manualPath, "manual", "utf8");

    const profiles = await service.prepareActorProfilesForMovie(config, {
      movieDir,
      nfoPath,
      actors: ["Actor A", "Actor B"],
      actorProfiles: [
        { name: "Actor A", photo_url: "https://img.example.com/actor-a.jpg" },
        { name: "Actor B", photo_url: "https://img.example.com/actor-b.jpg" },
      ],
    });

    const queue = JSON.parse(await readFile(join(root, ".cache", "queue.json"), "utf8")) as {
      pending: Record<string, { batchNfoPaths: string[] }>;
    };

    expect(profiles).toEqual([
      { name: "Actor A", photo_url: ".actors/Actor A.jpg" },
      { name: "Actor B", photo_url: undefined },
    ]);
    expect(await readFile(join(movieDir, ".actors", "Actor A.jpg"), "utf8")).toBe("manual");
    expect(queue.pending.actorb).toMatchObject({
      batchNfoPaths: [nfoPath],
    });
  });

  it("returns queued batch NFO paths when storing a remote image", async () => {
    const root = await createTempDir();
    const config = createConfig(root);
    const service = new ActorImageService();
    const nfoA = join(root, "Movie1", "ABC-001.nfo");
    const nfoB = join(root, "Movie2", "ABC-002.nfo");

    await service.enqueue(config, { name: "Actor A", batchNfoPath: nfoA });
    await service.enqueue(config, { name: "Actor A", batchNfoPath: nfoB });

    const result = await service.storeRemoteImage(config, {
      name: "Actor A",
      source: "official",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpg",
    });

    expect(result?.batchNfoPaths).toEqual([nfoA, nfoB]);

    const queue = JSON.parse(await readFile(join(root, ".cache", "queue.json"), "utf8")) as {
      pending: Record<string, unknown>;
    };
    expect(queue.pending.actora).toBeUndefined();
  });

  it("backfills actor thumbs in existing NFO files after remote image download", async () => {
    const root = await createTempDir();
    const service = new ActorImageService();
    const nfoGenerator = new NfoGenerator();

    const movieDir = join(root, "Movie1");
    const nfoPath = join(movieDir, "ABC-123.nfo");
    const actorImagePath = join(root, "library", "Actor B.jpg");
    await mkdir(join(root, "library"), { recursive: true });
    await mkdir(movieDir, { recursive: true });
    await writeFile(actorImagePath, "actor-b-image", "utf8");

    const originalXml = nfoGenerator.buildXml({
      title: "Sample Title",
      number: "ABC-123",
      actors: ["Actor A", "Actor B"],
      actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }, { name: "Actor B" }],
      genres: [],
      sample_images: [],
      website: Website.DMM,
    });
    await writeFile(nfoPath, originalXml, "utf8");

    await service.backfillBatch({
      actorName: "Actor B",
      imagePath: actorImagePath,
      nfoPaths: [nfoPath],
    });

    const updatedXml = await readFile(nfoPath, "utf8");
    expect(updatedXml).toContain(".actors/Actor B.jpg");
    expect(await readFile(join(movieDir, ".actors", "Actor B.jpg"), "utf8")).toBe("actor-b-image");
  });

  it("preserves existing actor thumbs when backfilling a different actor", async () => {
    const root = await createTempDir();
    const service = new ActorImageService();
    const nfoGenerator = new NfoGenerator();

    const movieDir = join(root, "Movie1");
    const nfoPath = join(movieDir, "ABC-123.nfo");
    const actorImagePath = join(root, "library", "Actor B.jpg");
    await mkdir(join(root, "library"), { recursive: true });
    await mkdir(movieDir, { recursive: true });
    await writeFile(actorImagePath, "actor-b-image", "utf8");

    const originalXml = nfoGenerator.buildXml({
      title: "Sample Title",
      number: "ABC-123",
      actors: ["Actor A", "Actor B"],
      actor_profiles: [{ name: "Actor A", photo_url: ".actors/Actor A.jpg" }, { name: "Actor B" }],
      genres: [],
      sample_images: [],
      website: Website.DMM,
    });
    await writeFile(nfoPath, originalXml, "utf8");

    await service.backfillBatch({
      actorName: "Actor B",
      imagePath: actorImagePath,
      nfoPaths: [nfoPath],
    });

    const updatedXml = await readFile(nfoPath, "utf8");
    expect(updatedXml).toContain(".actors/Actor A.jpg");
    expect(updatedXml).toContain(".actors/Actor B.jpg");
  });

  it("skips backfill gracefully when NFO file does not exist", async () => {
    const root = await createTempDir();
    const service = new ActorImageService();
    const actorImagePath = join(root, "Actor B.jpg");
    await writeFile(actorImagePath, "image", "utf8");

    await expect(
      service.backfillBatch({
        actorName: "Actor B",
        imagePath: actorImagePath,
        nfoPaths: [join(root, "nonexistent", "ABC-123.nfo")],
      }),
    ).resolves.toBeUndefined();
  });
});
