import { formatBytes } from "@renderer/components/overview/format";
import { describe, expect, it } from "vitest";

describe("overview format helpers", () => {
  it("formats byte counts for overview numeric UI", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});
