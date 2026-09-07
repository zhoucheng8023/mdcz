import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPublicationPlan } from "./createPublicationPlan";
import { createMemoryPublicationJournal } from "./memoryJournal";
import { preparePublicationPlan } from "./preparePublicationPlan";
import { commitPublishedMedia } from "./publishMedia";

const directories: string[] = [];
const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "mdcz-prepared-publication-"));
  directories.push(root);
  const source = join(root, "source");
  const output = join(root, "output");
  const staging = join(root, "staging");
  await Promise.all([mkdir(source), mkdir(output), mkdir(staging)]);
  return { root, source, output, staging };
};
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("preparePublicationPlan", () => {
  it("publishes preserved artwork, actor photos, trailer and NFO from the same final path inventory", async () => {
    const { root, source, output, staging } = await fixture();
    await mkdir(join(source, ".actors"));
    await mkdir(join(source, "extrafanart"));
    const files = ["movie.mp4", "movie.nfo", "poster.jpg", "trailer.mp4", ".actors/Actor.jpg", "extrafanart/scene.jpg"];
    for (const name of files) await writeFile(join(source, name), name);
    const publication = await preparePublicationPlan({
      sourceVideoPath: join(source, "movie.mp4"),
      outputVideoPath: join(output, "movie.mp4"),
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      existingAssets: {
        poster: join(source, "poster.jpg"),
        trailer: join(source, "trailer.mp4"),
        actorPhotos: [join(source, ".actors/Actor.jpg")],
        sceneImages: [join(source, "extrafanart/scene.jpg")],
      },
      existingNfoPath: join(source, "movie.nfo"),
      organizePlan: {
        outputDir: output,
        targetVideoPath: join(output, "movie.mp4"),
        nfoPath: join(output, "movie.nfo"),
      },
      nfoNaming: "movie",
      writeNfo: async () => undefined,
    });
    expect(publication.nfoPath).toBe(join(output, "movie.nfo"));
    expect(publication.assets.actorPhotos).toEqual([join(output, ".actors/Actor.jpg")]);
    expect(publication.plan.sidecars?.some((move) => move.sourcePath === join(source, "trailer.mp4"))).toBe(true);
    const mediaRoot = { id: "root", hostPath: root };
    await commitPublishedMedia(createPublicationPlan("test", "maintenance", publication.plan, [mediaRoot]), {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: () => undefined,
    });
    for (const name of files) {
      expect(await readFile(join(output, name), "utf8")).toBe(name);
      await expect(readFile(join(source, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it.each([
    "https://media.example/movie.mp4",
    "/media/movie.mp4",
    "../media/movie.mp4",
  ])("mirrors STRM target %s without introducing an extra STRM hop", async (target) => {
    const { root, source, output, staging } = await fixture();
    const original = `\uFEFF#KODIPROP:inputstream=inputstream.adaptive\r\n${target}\r\n`;
    await writeFile(join(source, "movie.strm"), original);
    const publication = await preparePublicationPlan({
      sourceVideoPath: join(source, "movie.strm"),
      outputVideoPath: join(output, "movie.strm"),
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      organizePlan: {
        outputDir: output,
        targetVideoPath: join(output, "movie.strm"),
        nfoPath: join(output, "movie.nfo"),
        strmPath: join(root, "mirror.strm"),
      },
      nfoNaming: "movie",
      writeNfo: async () => undefined,
    });
    const artifact = publication.plan.artifacts.find((artifact) => artifact.targetPath === join(root, "mirror.strm"));
    expect(artifact?.content.data).toBe(
      target.startsWith("..") ? original.replace(target, join(root, "media/movie.mp4")) : original,
    );
    expect(await readFile(join(source, "movie.strm"), "utf8")).toBe(original);
  });
});
