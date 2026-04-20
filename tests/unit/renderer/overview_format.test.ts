import { formatBytes } from "@renderer/utils/format";
import { describe, expect, it } from "vitest";

describe("overview format helpers", () => {
  it("formats byte counts for overview numeric UI", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("supports compact and fixed precision variants", () => {
    expect(formatBytes(10 * 1024, { trimTrailingZeros: true })).toBe("10 KB");
    expect(formatBytes(1536, { fractionDigits: 2 })).toBe("1.50 KB");
  });
});
