import { createOverviewInvalidationTracker } from "@renderer/hooks/useIpcSync";
import { describe, expect, it } from "vitest";

describe("useIpcSync overview invalidation tracking", () => {
  it("invalidates only on buttonStatus-derived active to idle transitions", () => {
    const shouldInvalidate = createOverviewInvalidationTracker();

    expect(shouldInvalidate(false)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(true)).toBe(false);
    expect(shouldInvalidate(false)).toBe(true);
    expect(shouldInvalidate(false)).toBe(false);
  });
});
