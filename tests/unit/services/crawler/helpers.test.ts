import { pickSearchResultDetailUrl } from "@main/services/crawler/sites/helpers";
import { describe, expect, it } from "vitest";

describe("pickSearchResultDetailUrl", () => {
  it("returns the first candidate that matches the expected number", () => {
    expect(
      pickSearchResultDetailUrl(
        "https://example.com",
        ["/video/SSIS-999", "/video/ABF_00075", "/video/ABF_075-extra"],
        "ABF-075",
      ),
    ).toBe("https://example.com/video/ABF_00075");
  });

  it("returns null when candidates exist but none match the expected number", () => {
    expect(
      pickSearchResultDetailUrl("https://example.com", ["/video/SSIS-999", "/video/IPZZ-123"], "ABF-075"),
    ).toBeNull();
  });
});
