import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Configuration, defaultConfiguration } from "@mdcz/shared/config";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { preflightScrapeTask, ScrapeTargetConflictError } from "./preflightScrapeTask";

let root: string;
let output: string;
let configuration: Configuration;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mdcz-scrape-preflight-"));
  output = join(root, "output");
  configuration = {
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      mediaPath: output,
      successOutputFolder: "",
      metadataPath: join(output, "metadata"),
    },
  };
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("preflightScrapeTask", () => {
  it.each([
    {
      name: "all existing conflicts, including a multipart input",
      sources: ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4", "ABF-981.mp4"],
      targets: ["Actor/ABC-123/ABC-123-CD1.mp4", "Actor/ABF-981/ABF-981.strm"],
      conflicts: 2,
    },
    { name: "another part", sources: ["ABC-123-CD2.mp4"], targets: ["Actor/ABC-123/ABC-123-CD1.mp4"], conflicts: 0 },
    { name: "new multipart group", sources: ["ABC-123-CD1.mp4", "ABC-123-CD2.mp4"], targets: [], conflicts: 0 },
    {
      name: "attachments and metadata mirrors",
      sources: ["ABC-123.mp4", "FC2-123456.mp4"],
      targets: [
        "Actor/ABC-123/ABC-123.nfo",
        "Actor/ABC-123/ABC-123-poster.jpg",
        "Actor/ABC-123/ABC-123.zh.srt",
        "Actor/ABC-123/ABC-123-trailer.mp4",
        "FC2-123456/FC2-123456-花絮.mp4",
        "FC2-123456/FC2-123456-trailer.mp4",
        "metadata/Actor/ABC-123/ABC-123.strm",
      ],
      conflicts: 0,
    },
    {
      name: "duplicate input versions",
      sources: ["ABC-123-1080p.mp4", "ABC-123-2160p.mp4"],
      targets: [],
      conflicts: 1,
    },
  ])("checks $name by number and part", async ({ sources, targets, conflicts }) => {
    for (const file of [
      ...sources.map((file) => join(root, "source", file)),
      ...targets.map((file) => join(output, file)),
    ]) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "original content");
    }
    const run = preflightScrapeTask({
      files: sources.map((file) => ({ sourcePath: join(root, "source", file) })),
      configuration,
      executionMode: "batch",
    });
    if (conflicts) {
      const error = await run.catch((error) => error);
      expect(error).toBeInstanceOf(ScrapeTargetConflictError);
      expect(error.conflicts).toHaveLength(conflicts);
    } else await expect(run).resolves.toBeUndefined();
  });

  it.each(["single", "batch", "alias"] as const)("allows the source itself in %s mode", async (mode) => {
    await mkdir(join(output, "Actor/ABC-123"), { recursive: true });
    await writeFile(join(output, "Actor/ABC-123/ABC-123.mp4"), "video");
    const alias = join(root, "alias");
    if (mode === "alias") await symlink(output, alias, "junction");
    await expect(
      preflightScrapeTask({
        files: [{ sourcePath: join(mode === "alias" ? alias : output, "Actor/ABC-123/ABC-123.mp4") }],
        configuration,
        executionMode: mode === "single" ? "single" : "batch",
      }),
    ).resolves.toBeUndefined();
  });

  it("identifies title-only output through the local NFO", async () => {
    await mkdir(join(output, "Actor/Title"), { recursive: true });
    await writeFile(join(output, "Actor/Title/Title.mp4"), "video");
    await writeFile(join(output, "Actor/Title/movie.nfo"), '<movie><uniqueid type="javdb">ABC-123</uniqueid></movie>');
    await expect(
      preflightScrapeTask({
        files: [{ sourcePath: join(root, "ABC-123.mp4") }],
        configuration: {
          ...configuration,
          naming: { ...configuration.naming, fileTemplate: "{title}", folderTemplate: "{actor}/{title}" },
        },
        executionMode: "batch",
      }),
    ).rejects.toBeInstanceOf(ScrapeTargetConflictError);
  });
});
