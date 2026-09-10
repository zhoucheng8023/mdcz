import { describe, expect, it } from "vitest";
import { createServerTranslationMappingStore, resolveServerBundledMappingDirectory } from "./translationMappingStore";

describe("server translation mapping store", () => {
  it("resolves distributed mappings", async () => {
    const store = createServerTranslationMappingStore();

    expect(resolveServerBundledMappingDirectory()).toContain("mapping_table");
    await expect(store.findMappedActorName("AV女優", "jp")).resolves.toBe("女優");
  });
});
