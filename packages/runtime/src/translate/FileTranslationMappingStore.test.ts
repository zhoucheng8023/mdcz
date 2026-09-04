import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FileTranslationMappingStore } from "./FileTranslationMappingStore";

const writeMappingFile = async (filePath: string, entries: unknown[]): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify({ version: 1, source: "test", entries })}\n`, "utf8");
};

describe("FileTranslationMappingStore", () => {
  let root = "";
  let bundledDirectory = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "runtime-translation-mapping-"));
    bundledDirectory = join(root, "bundled");
    await mkdir(bundledDirectory, { recursive: true });
  });

  it("loads actor aliases and localized genres", async () => {
    await writeMappingFile(join(bundledDirectory, "mapping_actor.json"), [
      { canonical: "Canonical Name", aliases: ["Alias"] },
    ]);
    await writeMappingFile(join(bundledDirectory, "mapping_info.json"), [
      { keywords: ["Drama"], zh_cn: "剧情", zh_tw: "劇情" },
    ]);

    const store = new FileTranslationMappingStore(bundledDirectory);

    await expect(store.findMappedActorName("alias", "jp")).resolves.toBe("Canonical Name");
    await expect(store.findMappedGenreName("drama", "zh_tw")).resolves.toBe("劇情");
  });
});
