import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MaintenanceArtifactResolver } from "@main/services/scraper/maintenance/MaintenanceArtifactResolver";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-maintenance-artifacts-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createEntry = (root: string, nfoFileName = "ABC-123.nfo") => ({
  id: "entry-1",
  videoPath: join(root, "ABC-123.mp4"),
  fileInfo: {
    filePath: join(root, "ABC-123.mp4"),
    fileName: "ABC-123.mp4",
    extension: ".mp4",
    number: "ABC-123",
    isSubtitled: false,
  },
  nfoPath: join(root, nfoFileName),
  assets: {
    sceneImages: [],
    actorPhotos: [],
    nfo: join(root, nfoFileName),
  },
  currentDir: root,
});

const createPlan = (root: string) => {
  const outputDir = join(root, "organized");
  return {
    outputDir,
    targetVideoPath: join(outputDir, "ABC-123.mp4"),
    nfoPath: join(outputDir, "ABC-123.nfo"),
  };
};

const emptyDownloadedAssets = {
  sceneImages: [],
  downloaded: [],
};

describe("MaintenanceArtifactResolver", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("reconciles kept NFO naming during maintenance reorganization", async () => {
    for (const scenario of [
      {
        nfoNaming: "filename" as const,
        expectedCanonicalName: "ABC-123.nfo",
        expectMovieAlias: false,
        title: "Kept Title",
      },
      {
        nfoNaming: "movie" as const,
        expectedCanonicalName: "movie.nfo",
        expectMovieAlias: true,
        title: "Movie Mode",
      },
    ]) {
      const root = await createTempDir();
      const entry = createEntry(root);
      const plan = createPlan(root);
      const resolver = new MaintenanceArtifactResolver();
      const canonicalPath = join(plan.outputDir, scenario.expectedCanonicalName);
      const filenamePath = plan.nfoPath;
      const moviePath = join(plan.outputDir, "movie.nfo");
      const sourceMoviePath = join(root, "movie.nfo");

      await writeFile(entry.nfoPath, `<movie><title>${scenario.title}</title></movie>`, "utf8");
      await writeFile(sourceMoviePath, "<movie><title>Stale Alias</title></movie>", "utf8");

      const result = await resolver.resolve({
        entry,
        plan,
        outputVideoPath: plan.targetVideoPath,
        assets: emptyDownloadedAssets,
        nfoNaming: scenario.nfoNaming,
      });

      expect(result.nfoPath).toBe(canonicalPath);
      await expect(readFile(canonicalPath, "utf8")).resolves.toContain(scenario.title);
      await expect(readFile(sourceMoviePath, "utf8")).rejects.toThrow();
      if (scenario.expectMovieAlias) {
        await expect(readFile(filenamePath, "utf8")).rejects.toThrow();
        continue;
      }
      await expect(readFile(moviePath, "utf8")).rejects.toThrow();
    }
  });
});
