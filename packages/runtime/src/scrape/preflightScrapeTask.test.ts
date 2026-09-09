import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ScrapeTargetConflictError, validatePreparedScrapeFiles } from "./preflightScrapeTask";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mdcz-scrape-prepared-check-"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const target = (itemId: string, sourcePath: string, targetVideoPath: string) => ({
  itemId,
  sourcePath,
  outputPlan: { targetVideoPath },
});

describe("validatePreparedScrapeFiles", () => {
  it("rejects an existing main video with the same extensionless name", async () => {
    const sourcePath = join(root, "source", "ABF-981.mp4");
    const targetPath = join(root, "output", "ABF-981.mkv");
    await mkdir(dirname(sourcePath), { recursive: true });
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(sourcePath, "source");
    await writeFile(targetPath, "existing");

    const run = validatePreparedScrapeFiles([target("one", sourcePath, join(root, "output", "ABF-981.mp4"))]);
    const error = await run.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ScrapeTargetConflictError);
    expect((error as ScrapeTargetConflictError).conflicts).toEqual([
      expect.objectContaining({ itemId: "one", targetPath }),
    ]);
  });

  it("rejects duplicate planned main-video names inside the batch", async () => {
    const first = join(root, "source", "first.mp4");
    const second = join(root, "source", "second.mkv");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "first");
    await writeFile(second, "second");

    await expect(
      validatePreparedScrapeFiles([
        target("one", first, join(root, "output", "ABC-123.mp4")),
        target("two", second, join(root, "output", "ABC-123.mkv")),
      ]),
    ).rejects.toMatchObject({
      conflicts: [expect.objectContaining({ itemId: "one" }), expect.objectContaining({ itemId: "two" })],
    });
  });

  it("allows multipart targets, different directories, attachments, and in-place rescrapes", async () => {
    const first = join(root, "source", "ABC-123-CD1.mp4");
    const second = join(root, "source", "ABC-123-CD2.mp4");
    await mkdir(dirname(first), { recursive: true });
    await writeFile(first, "first");
    await writeFile(second, "second");
    await writeFile(join(root, "source", "ABC-123-CD1.nfo"), "nfo");
    await writeFile(join(root, "source", "ABC-123-CD1-poster.jpg"), "poster");
    await writeFile(join(root, "source", "ABC-123-CD1-trailer.mp4"), "trailer");

    await expect(
      validatePreparedScrapeFiles([
        target("one", first, first),
        target("two", second, join(root, "other", "ABC-123-CD2.mp4")),
        target("three", join(root, "third.mp4"), join(root, "another", "ABC-123-CD1.mkv")),
      ]),
    ).resolves.toBeUndefined();
  });
});
