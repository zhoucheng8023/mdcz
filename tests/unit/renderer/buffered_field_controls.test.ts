import { parseBufferedNumberValue } from "@renderer/components/config-form/BufferedFieldControls";
import { describe, expect, it } from "vitest";

describe("bufferedFieldControls", () => {
  it("parses valid numeric drafts and falls back to the committed value for blank or invalid drafts", () => {
    expect(parseBufferedNumberValue("45", 30)).toBe(45);
    expect(parseBufferedNumberValue("  12.5  ", 30)).toBe(12.5);
    expect(parseBufferedNumberValue("", 30)).toBe(30);
    expect(parseBufferedNumberValue("abc", 30)).toBe(30);
    expect(parseBufferedNumberValue("", undefined)).toBe(0);
  });
});
