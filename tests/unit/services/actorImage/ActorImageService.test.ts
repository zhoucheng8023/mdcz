import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActorImageService } from "@main/services/ActorImageService";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
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
    personSync: {
      ...defaultConfiguration.personSync,
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

  it("returns fallback on corrupt index.json without overwriting the file", async () => {
    const root = await createTempDir();
    const config = createConfig(root);
    const service = new ActorImageService();

    await mkdir(join(root, ".cache"), { recursive: true });
    await writeFile(join(root, ".cache", "index.json"), "not valid json", "utf8");

    const resolved = await service.resolveLocalImage(config, ["Actor A"]);

    expect(resolved).toBeUndefined();
    expect(await readFile(join(root, ".cache", "index.json"), "utf8")).toBe("not valid json");
  });
});
