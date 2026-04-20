import type { ConfigOutput } from "@renderer/client/types";
import {
  filterMediaCandidates,
  mergeMediaCandidates,
  resolveMediaCandidateScanPlan,
} from "@renderer/components/workbench/mediaCandidateScan";
import type { MediaCandidate } from "@shared/types";
import { describe, expect, it } from "vitest";

const rootDir = process.platform === "win32" ? "D:\\media" : "/media";
const successDir = process.platform === "win32" ? "D:\\media\\JAV_output" : "/media/JAV_output";
const failedDir = process.platform === "win32" ? "D:\\media\\failed" : "/media/failed";
const softlinkDir = process.platform === "win32" ? "D:\\softlink" : "/softlink";

const createConfig = (overrides?: Partial<ConfigOutput>): ConfigOutput =>
  ({
    paths: {
      mediaPath: rootDir,
      successOutputFolder: "JAV_output",
      failedOutputFolder: "failed",
      softlinkPath: softlinkDir,
      outputSummaryPath: "",
    },
    behavior: {
      scrapeSoftlinkPath: true,
    },
    ...overrides,
  }) as ConfigOutput;

const createCandidate = (path: string): MediaCandidate => ({
  path,
  name: path.split(/[\\/]+/u).at(-1) ?? path,
  size: 1,
  lastModified: null,
  extension: ".mp4",
  relativePath: path,
  relativeDirectory: "",
});

describe("mediaCandidateScan", () => {
  it("builds a scrape scan plan that excludes failed output folders and adds the softlink scan root", () => {
    const plan = resolveMediaCandidateScanPlan("scrape", rootDir, successDir, createConfig());

    expect(plan.excludeDirPath).toBe(successDir);
    expect(plan.filterDirPaths).toEqual([successDir, failedDir]);
    expect(plan.extraScanDirs).toEqual([softlinkDir]);
  });

  it("filters candidates that live inside excluded output directories", () => {
    const keptVideo = createCandidate(
      process.platform === "win32" ? "D:\\media\\library\\ABC-123.mp4" : "/media/library/ABC-123.mp4",
    );
    const failedVideo = createCandidate(
      process.platform === "win32" ? "D:\\media\\failed\\XYZ-999.mp4" : "/media/failed/XYZ-999.mp4",
    );
    const successVideo = createCandidate(
      process.platform === "win32" ? "D:\\media\\JAV_output\\DONE-001.mp4" : "/media/JAV_output/DONE-001.mp4",
    );

    expect(filterMediaCandidates([keptVideo, failedVideo, successVideo], [successDir, failedDir])).toEqual([keptVideo]);
  });

  it("dedupes merged candidate groups while preserving the first occurrence", () => {
    const first = createCandidate(process.platform === "win32" ? "D:\\media\\ABC-123.mp4" : "/media/ABC-123.mp4");
    const duplicate = createCandidate(process.platform === "win32" ? "D:\\MEDIA\\ABC-123.mp4" : "/media/ABC-123.mp4");
    const second = createCandidate(
      process.platform === "win32" ? "D:\\softlink\\SOFT-001.mp4" : "/softlink/SOFT-001.mp4",
    );

    expect(mergeMediaCandidates([first], [duplicate, second])).toEqual([first, second]);
  });
});
