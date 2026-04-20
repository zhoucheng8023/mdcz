import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Configuration, configurationSchema, defaultConfiguration } from "@main/services/config";
import { OutputLibraryScanner } from "@main/services/library/OutputLibraryScanner";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-output-library-scanner-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createConfiguration = (paths: Partial<Configuration["paths"]>): Configuration =>
  configurationSchema.parse({
    ...defaultConfiguration,
    paths: {
      ...defaultConfiguration.paths,
      ...paths,
    },
  });

describe("OutputLibraryScanner", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("uses the default output path, caches scans, and rescans after invalidate", async () => {
    const root = await createTempDir();
    const outputDir = join(root, "media", "JAV_output");
    await mkdir(join(outputDir, "nested"), { recursive: true });
    await writeFile(join(outputDir, "A.mp4"), Buffer.alloc(4));
    await writeFile(join(outputDir, "nested", "B.mkv"), Buffer.alloc(6));
    await writeFile(join(outputDir, "ignored.txt"), Buffer.alloc(10));

    const configuration = createConfiguration({
      mediaPath: join(root, "media"),
      successOutputFolder: "JAV_output",
      outputSummaryPath: "",
    });
    const scanner = new OutputLibraryScanner({
      configProvider: async () => configuration,
      ttlMs: 60_000,
      now: () => 12_345,
      logger: { warn: vi.fn() },
    });

    const first = await scanner.getSummary();
    expect(first).toEqual({
      fileCount: 2,
      totalBytes: 10,
      scannedAt: 12_345,
      rootPath: outputDir,
    });

    await writeFile(join(outputDir, "C.webm"), Buffer.alloc(8));

    await expect(scanner.getSummary()).resolves.toEqual(first);

    scanner.invalidate();

    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 3,
      totalBytes: 18,
      scannedAt: 12_345,
      rootPath: outputDir,
    });
  });

  it("returns an empty summary when the configured root is missing", async () => {
    const root = await createTempDir();
    const missingRoot = join(root, "missing");
    const scanner = new OutputLibraryScanner({
      configProvider: async () =>
        createConfiguration({
          mediaPath: join(root, "media"),
          successOutputFolder: "JAV_output",
          outputSummaryPath: missingRoot,
        }),
      now: () => 456,
      logger: { warn: vi.fn() },
    });

    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 0,
      totalBytes: 0,
      scannedAt: 456,
      rootPath: null,
    });
  });

  it("resolves an absolute success output folder without prefixing the media root", async () => {
    const root = await createTempDir();
    const mediaRoot = join(root, "media");
    const absoluteOutputDir = join(root, "absolute-output");
    await mkdir(absoluteOutputDir, { recursive: true });
    await writeFile(join(absoluteOutputDir, "ABS-001.mp4"), Buffer.alloc(3));

    const scanner = new OutputLibraryScanner({
      configProvider: async () =>
        createConfiguration({
          mediaPath: mediaRoot,
          successOutputFolder: absoluteOutputDir,
          outputSummaryPath: "",
        }),
      now: () => 789,
      logger: { warn: vi.fn() },
    });

    await expect(scanner.getSummary()).resolves.toEqual({
      fileCount: 1,
      totalBytes: 3,
      scannedAt: 789,
      rootPath: absoluteOutputDir,
    });
  });
});
