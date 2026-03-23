import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { copyFileMock, linkMock, symlinkMock } = vi.hoisted(() => ({
  copyFileMock: vi.fn(),
  linkMock: vi.fn(),
  symlinkMock: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    copyFile: copyFileMock,
    link: linkMock,
    symlink: symlinkMock,
  };
});

import { ActorPhotoMaterializer } from "@main/services/actorImage/ActorPhotoMaterializer";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-actor-photo-materializer-"));
  tempDirs.push(dirPath);
  return dirPath;
};

describe("ActorPhotoMaterializer", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    copyFileMock.mockReset();
    linkMock.mockReset();
    symlinkMock.mockReset();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("returns undefined when link, symlink, and copy all fail", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "movie");
    const sourcePath = join(root, "actor.jpg");
    await writeFile(sourcePath, "actor", "utf8");

    linkMock.mockRejectedValue(new Error("link failed"));
    symlinkMock.mockRejectedValue(new Error("symlink failed"));
    copyFileMock.mockRejectedValue(new Error("copy failed"));

    const logger = {
      info: vi.fn(),
    };

    const result = await new ActorPhotoMaterializer(logger).materializeForMovie(movieDir, "Actor A", sourcePath);

    expect(result).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
