import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Website } from "@mdcz/shared/enums";
import { afterEach, describe, expect, it } from "vitest";
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
    "keep_existing",
    "keep_new",
    "keep_both",
  ] as const)("resolves only the video conflict with %s and preserves subtitle ownership", async (choice) => {
    const { root, source, output, staging } = await fixture();
    const sourceVideoPath = join(source, "ABC-123.mp4");
    const outputVideoPath = join(output, "ABC-123.mp4");
    const nfoPath = join(output, "ABC-123.nfo");
    const strmPath = join(output, "ABC-123.strm");
    const subtitles = [".zh.srt", ".ass", ".idx", ".sub"];
    for (const suffix of [".mp4", ".nfo", ".strm", "-poster.jpg", ...subtitles]) {
      await writeFile(join(output, `ABC-123${suffix}`), `old${suffix}`);
    }
    await writeFile(join(output, "ABC-123 (1).zh.srt"), "reserved subtitle");
    await writeFile(sourceVideoPath, "new video");
    for (const suffix of subtitles) await writeFile(join(source, `ABC-123${suffix}`), `new${suffix}`);
    await writeFile(join(staging, "ABC-123-poster.jpg"), "new poster");
    const generator = new NfoGenerator();
    const { plan: prepared } = await preparePublicationPlan({
      sourceVideoPath,
      outputVideoPath,
      stagingDir: staging,
      existingAssetDir: source,
      metadataOutputDir: output,
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
    const plan = createPublicationPlan("conflict", "scrape", prepared, [mediaRoot]);
    const options = {
      resolveRoot: async () => mediaRoot,
      journal: createMemoryPublicationJournal(),
      commit: () => undefined,
    };
    const conflict = await commitPublishedMedia(plan, options).catch((error) => error);
    expect(conflict).toBeInstanceOf(PublicationConflictError);
    expect(conflict.snapshot.targetPath).toBe(outputVideoPath);
    expect(conflict.snapshot.keepBothPath).toBe(join(output, "ABC-123 (2).mp4"));
    await conflict.applyChoice(choice);
    await commitPublishedMedia(plan, options);
    const newBase = choice === "keep_both" ? "ABC-123 (2)" : "ABC-123";
    expect(await readFile(join(output, `${newBase}.mp4`), "utf8")).toBe(
      choice === "keep_existing" ? "old.mp4" : "new video",
    );
    for (const suffix of subtitles) {
      expect(await readFile(join(output, `${newBase}${suffix}`), "utf8")).toBe(
        choice === "keep_existing" ? `old${suffix}` : `new${suffix}`,
      );
    }
    expect(await readFile(join(output, `${newBase}.strm`), "utf8")).toBe(join(output, `${newBase}.mp4`));
    const nfo = await readFile(join(output, `${newBase}.nfo`), "utf8");
    expect(nfo).toContain(`<thumb aspect="poster">${newBase}-poster.jpg</thumb>`);
    expect(nfo).toContain("<title>ABC-123-poster.jpg</title>");
    expect(await readFile(join(output, "ABC-123 (1).zh.srt"), "utf8")).toBe("reserved subtitle");
    if (choice === "keep_both") {
      for (const suffix of [".mp4", ".nfo", ".strm", "-poster.jpg", ...subtitles])
        expect(await readFile(join(output, `ABC-123${suffix}`), "utf8")).toBe(`old${suffix}`);
      expect((await findSubtitleSidecars(join(output, `${newBase}.mp4`))).map(({ path }) => path).sort()).toEqual(
        subtitles.map((suffix) => join(output, `${newBase}${suffix}`)).sort(),
      );
      expect((await findSubtitleSidecars(outputVideoPath)).map(({ path }) => path).sort()).toEqual(
        subtitles.map((suffix) => join(output, `ABC-123${suffix}`)).sort(),
      );
    }
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
