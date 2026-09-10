import type { ScrapeResult } from "@mdcz/shared/types";
import {
  buildAmbiguousUncensoredScrapeGroups,
  buildScrapeResultGroupActionContext,
  buildScrapeResultGroups,
  buildUncensoredConfirmItemsForScrapeGroups,
  summarizeUncensoredConfirmResultForScrapeGroups,
} from "@mdcz/shared/viewModels/scrapeResultGrouping";
import { describe, expect, it } from "vitest";

const createScrapeResult = (overrides: Partial<ScrapeResult> = {}): ScrapeResult => ({
  fileId: "part-1",
  rootId: "root-1",
  relativePath: "FC2-123456/FC2-123456-cd1.mp4",
  fileName: "FC2-123456-cd1.mp4",
  status: "success",
  assets: [],
  sources: {},
  crawlerData: {
    number: "FC2-123456",
    title: "FC2 Title",
    actors: [],
    genres: [],
    scene_images: [],
  },
  output: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456-cd1.mp4" },
  nfo: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456.nfo" },
  ...overrides,
});

describe("scrape result multipart grouping", () => {
  it("collapses same-directory multipart files into a single display group", () => {
    const part1 = createScrapeResult({
      fileId: "part-1",
      fileName: "FC2-123456-cd1.mp4",
      relativePath: "FC2-123456/FC2-123456-cd1.mp4",
      part: { number: 1, suffix: "-cd1" },
      crawlerData: { number: "FC2-123456", title: "FC2 Title", actors: ["Actor A"], genres: [], scene_images: [] },
      output: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456-cd1.mp4" },
    });
    const part2 = createScrapeResult({
      fileId: "part-2",
      fileName: "FC2-123456-cd2.mp4",
      relativePath: "FC2-123456/FC2-123456-cd2.mp4",
      part: { number: 2, suffix: "-cd2" },
      crawlerData: {
        number: "FC2-123456",
        title: "FC2 Title",
        actors: ["Actor A", "Actor B"],
        genres: [],
        scene_images: [],
      },
      output: { rootId: "root-1", relativePath: "FC2-123456/FC2-123456-cd2.mp4" },
    });
    const standalone = createScrapeResult({
      fileId: "standalone-1",
      fileName: "ABC-123.mp4",
      relativePath: "ABC-123/ABC-123.mp4",
      crawlerData: { number: "ABC-123", title: "ABC Title", actors: [], genres: [], scene_images: [] },
      output: { rootId: "root-1", relativePath: "ABC-123/ABC-123.mp4" },
    });

    const groups = buildScrapeResultGroups([part1, standalone, part2]);

    expect(groups).toHaveLength(2);
    const multiGroup = groups.find((group) => group.items.length === 2);
    expect(multiGroup).toBeDefined();
    expect(multiGroup?.items.map((item) => item.fileId)).toEqual(["part-1", "part-2"]);
    expect(multiGroup?.display.crawlerData?.actors).toEqual(["Actor A", "Actor B"]);
  });

  it("builds group action context with unified targets and NFO path", () => {
    const [group] = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "part-1",
        fileName: "FC2-123456-cd1.mp4",
        relativePath: "FC2-123456/FC2-123456-cd1.mp4",
        part: { number: 1, suffix: "-cd1" },
        output: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456-cd1.mp4" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
      }),
      createScrapeResult({
        fileId: "part-2",
        fileName: "FC2-123456-cd2.mp4",
        relativePath: "FC2-123456/FC2-123456-cd2.mp4",
        part: { number: 2, suffix: "-cd2" },
        output: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456-cd2.mp4" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
      }),
    ]);

    expect(group).toBeDefined();
    if (!group) return;

    const context = buildScrapeResultGroupActionContext(group, null);
    expect(context.selectedItem.fileId).toBe("part-1");
    expect(context.nfoPath).toBe("library/FC2-123456/FC2-123456.nfo");
    expect(context.videoPaths).toEqual([
      "library/FC2-123456/FC2-123456-cd1.mp4",
      "library/FC2-123456/FC2-123456-cd2.mp4",
    ]);
  });

  it("expands grouped uncensored confirmation to all ambiguous files in the group", () => {
    const groups = buildScrapeResultGroups([
      createScrapeResult({
        fileId: "part-1",
        fileName: "FC2-123456-cd1.mp4",
        relativePath: "FC2-123456/FC2-123456-cd1.mp4",
        part: { number: 1, suffix: "-cd1" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "part-2",
        fileName: "FC2-123456-cd2.mp4",
        relativePath: "FC2-123456/FC2-123456-cd2.mp4",
        part: { number: 2, suffix: "-cd2" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
        uncensoredAmbiguous: true,
      }),
    ]);

    expect(groups).toHaveLength(1);
    const groupId = groups[0]?.id ?? "";
    const confirmItems = buildUncensoredConfirmItemsForScrapeGroups(groups, { [groupId]: "leak" });

    expect(confirmItems).toEqual([
      { itemId: "part-1", choice: "leak" },
      { itemId: "part-2", choice: "leak" },
    ]);
  });

  it("summarizes uncensored confirmation by grouped entry instead of raw file count", () => {
    const groups = buildAmbiguousUncensoredScrapeGroups([
      createScrapeResult({
        fileId: "part-1",
        fileName: "FC2-123456-cd1.mp4",
        relativePath: "FC2-123456/FC2-123456-cd1.mp4",
        part: { number: 1, suffix: "-cd1" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
        uncensoredAmbiguous: true,
      }),
      createScrapeResult({
        fileId: "part-2",
        fileName: "FC2-123456-cd2.mp4",
        relativePath: "FC2-123456/FC2-123456-cd2.mp4",
        part: { number: 2, suffix: "-cd2" },
        nfo: { rootId: "root-1", relativePath: "library/FC2-123456/FC2-123456.nfo" },
        uncensoredAmbiguous: true,
      }),
    ]);

    expect(groups).toHaveLength(1);

    const summarySuccess = summarizeUncensoredConfirmResultForScrapeGroups(groups, [
      {
        fileId: "part-1",
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "umr",
      },
      {
        fileId: "part-2",
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd2.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd2.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "umr",
      },
    ]);

    expect(summarySuccess).toEqual({
      successCount: 1,
      failedCount: 0,
    });

    const summaryPartial = summarizeUncensoredConfirmResultForScrapeGroups(groups, [
      {
        fileId: "part-1",
        sourceVideoPath: "/library/FC2-123456/FC2-123456-cd1.mp4",
        sourceNfoPath: "/library/FC2-123456/FC2-123456.nfo",
        targetVideoPath: "/library/FC2-123456-UMR/FC2-123456-cd1.mp4",
        targetNfoPath: "/library/FC2-123456-UMR/FC2-123456.nfo",
        choice: "umr",
      },
    ]);

    expect(summaryPartial).toEqual({
      successCount: 0,
      failedCount: 1,
    });
  });
});
