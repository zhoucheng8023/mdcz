import { ProfileCapsule } from "@renderer/components/settings/ProfileCapsule";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const noop = vi.fn();

describe("ProfileCapsule", () => {
  it("does not render the fallback default label while the active profile is still loading", () => {
    const html = renderToStaticMarkup(
      createElement(ProfileCapsule, {
        profiles: [],
        activeProfile: null,
        isLoading: true,
        onSwitchProfile: noop,
        onCreateProfile: noop,
        onDeleteProfile: noop,
        onResetConfig: noop,
        onExportProfile: noop,
        onImportProfile: noop,
      }),
    );

    expect(html).not.toContain("默认配置");
    expect(html).toContain("aria-busy");
  });
});
