import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it, vi } from "vitest";
import { findSubtitleSidecars } from "../scrape/media";
import { NfoGenerator } from "../scrape/nfo";
import { PublicationConflictError } from "./conflicts";
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
  it.each([
    { extension: ".mp4", conflict: true },
    { extension: ".strm", conflict: true },
    { extension: ".mp4", conflict: false },
    { extension: ".strm", conflict: false },
  ])("protects both videos and their attachments ($extension, conflict=$conflict)", async ({ extension, conflict }) => {
    const { root, source, output, staging } = await fixture();
    const metadata = join(root, "metadata");
    await mkdir(metadata);
    const sourceVideoPath = join(source, `ABC-123${extension}`);
    const outputVideoPath = join(output, `ABC-123${extension}`);
    const nfoPath = join(metadata, "ABC-123.nfo");
    const strmPath = join(metadata, "ABC-123.strm");
    const subtitles = [".zh.srt", ".ass", ".idx", ".sub"];
    for (const suffix of [".nfo", ".strm", "-poster.jpg"])
      await writeFile(join(metadata, `ABC-123${suffix}`), `old${suffix}`);
    for (const suffix of subtitles.filter((suffix) => suffix !== ".ass"))
      await writeFile(join(output, `ABC-123${suffix}`), `old${suffix}`);
    if (conflict) await writeFile(outputVideoPath, "old video");
    const videoContent = extension === ".strm" ? "https://new.example/video.mp4" : "new video";
    await writeFile(sourceVideoPath, videoContent);
    for (const suffix of subtitles) await writeFile(join(source, `ABC-123${suffix}`), `new${suffix}`);
    await writeFile(join(staging, "ABC-123-poster.jpg"), "new poster");
    const generator = new NfoGenerator();
    const { plan: prepared } = await preparePublicationPlan({
      sourceVideoPath,
      outputVideoPath,
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: metadata,
      downloadedAssets: { downloaded: [], sceneImages: [], poster: join(staging, "ABC-123-poster.jpg") },
      actorPhotoPaths: [],
      nfoNaming: "both",
      organizePlan: {
        outputDir: output,
        targetVideoPath: outputVideoPath,
        nfoPath,
        strmPath,
        subtitleSidecars: await findSubtitleSidecars(sourceVideoPath),
      },
      writeNfo: (assets, writeFile) =>
        generator.writeNfo(
          nfoPath,
          {
            number: "ABC-123",
            title: "ABC-123-poster.jpg",
            actors: [],
            genres: [],
            scene_images: [],
            website: Website.JAVDB,
          },
          { assets, nfoNaming: "both", writeFile },
        ),
    });
    const mediaRoot = { id: "root", hostPath: root };
    const plan = createPublicationPlan("publication", "scrape", prepared, [mediaRoot]);
    const options = {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: vi.fn(),
    };
    if (conflict) {
      const video = plan.videos?.[0];
      if (!video) throw new Error("Fixture video is required");
      plan.replaceExistingTargets = [...(plan.replaceExistingTargets ?? []), video.target];
      await expect(commitPublishedMedia(plan, options)).rejects.toBeInstanceOf(PublicationConflictError);
      expect(options.commit).not.toHaveBeenCalled();
      expect(options.journal.listUnfinished()).toEqual([]);
      expect(await readFile(sourceVideoPath, "utf8")).toBe(videoContent);
      expect(await readFile(outputVideoPath, "utf8")).toBe("old video");
      for (const suffix of [".nfo", ".strm", "-poster.jpg"])
        expect(await readFile(join(metadata, `ABC-123${suffix}`), "utf8")).toBe(`old${suffix}`);
      for (const suffix of subtitles) {
        expect(await readFile(join(source, `ABC-123${suffix}`), "utf8")).toBe(`new${suffix}`);
        if (suffix === ".ass")
          await expect(readFile(join(output, `ABC-123${suffix}`))).rejects.toMatchObject({ code: "ENOENT" });
        else expect(await readFile(join(output, `ABC-123${suffix}`), "utf8")).toBe(`old${suffix}`);
      }
      return;
    }
    await commitPublishedMedia(plan, options);
    expect(options.commit).toHaveBeenCalledOnce();
    expect((await readFile(outputVideoPath, "utf8")).trim()).toBe(videoContent);
    for (const suffix of subtitles)
      expect(await readFile(join(output, `ABC-123${suffix}`), "utf8")).toBe(`new${suffix}`);
    expect((await readFile(strmPath, "utf8")).trim()).toBe(extension === ".strm" ? videoContent : outputVideoPath);
    const nfo = await readFile(nfoPath, "utf8");
    expect(nfo).toContain('<thumb aspect="poster">ABC-123-poster.jpg</thumb>');
    expect(nfo).toContain("<title>ABC-123-poster.jpg</title>");
  });
  it.each([
    false,
    true,
  ])("publishes preserved assets and retains sources still shared by another video (%s)", async (shared) => {
    const { root, source, output, staging } = await fixture();
    await mkdir(join(source, ".actors"));
    await mkdir(join(source, "extrafanart"));
    const files = ["movie.mp4", "movie.nfo", "poster.jpg", "trailer.mp4", ".actors/Actor.jpg", "extrafanart/scene.jpg"];
    for (const name of files) await writeFile(join(source, name), name);
    if (shared) await writeFile(join(source, "another.mp4"), "another video");
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
      if (shared && name !== "movie.mp4") expect(await readFile(join(source, name), "utf8")).toBe(name);
      else await expect(readFile(join(source, name))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it.each([
    "filename",
    "movie",
    "both",
  ] as const)("reconciles preserved NFOs using %s naming only after commit", async (nfoNaming) => {
    const { root, source, output } = await fixture();
    const sourceVideoPath = join(source, "ABC-123.mp4");
    const outputVideoPath = join(output, "ABC-123.mp4");
    const original = "<movie><title>Original</title></movie>";
    await writeFile(sourceVideoPath, "video");
    for (const name of ["ABC-123.nfo", "movie.nfo"]) {
      await writeFile(join(source, name), original);
      await writeFile(join(output, name), "stale");
    }
    const publication = await preparePublicationPlan({
      sourceVideoPath,
      outputVideoPath,
      existingAssetDir: source,
      metadataOutputDir: output,
      downloadedAssets: { downloaded: [], sceneImages: [] },
      actorPhotoPaths: [],
      existingNfoPath: join(source, "ABC-123.nfo"),
      nfoNaming,
      organizePlan: { outputDir: output, targetVideoPath: outputVideoPath, nfoPath: join(output, "ABC-123.nfo") },
      writeNfo: async () => undefined,
    });
    expect(await readFile(join(source, "ABC-123.nfo"), "utf8")).toBe(original);
    const mediaRoot = { id: "root", hostPath: root };
    await commitPublishedMedia(createPublicationPlan("nfo", "maintenance", publication.plan, [mediaRoot]), {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: () => undefined,
    });
    for (const name of ["ABC-123.nfo", "movie.nfo"]) {
      const retained = nfoNaming === "both" || (nfoNaming === "movie" ? name === "movie.nfo" : name === "ABC-123.nfo");
      if (retained) expect(await readFile(join(output, name), "utf8")).toBe(original);
      else await expect(readFile(join(output, name))).rejects.toMatchObject({ code: "ENOENT" });
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
