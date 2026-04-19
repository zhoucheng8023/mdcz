import {
  buildTitleBarOverlay,
  resolveCustomTitleBarWindowOptions,
  shouldSyncTitleBarOverlay,
} from "@main/services/windowTitleBarOptions";
import { describe, expect, it } from "vitest";

describe("window title bar options", () => {
  it("uses native window chrome when custom titlebar is disabled", () => {
    expect(
      resolveCustomTitleBarWindowOptions({
        useCustomTitleBar: false,
        platform: "win32",
        isDark: true,
      }),
    ).toEqual({});
  });

  it("uses hiddenInset on macOS custom titlebars", () => {
    expect(
      resolveCustomTitleBarWindowOptions({
        useCustomTitleBar: true,
        platform: "darwin",
        isDark: true,
      }),
    ).toEqual({ titleBarStyle: "hiddenInset" });
  });

  it("uses titleBarOverlay with hidden titlebar on Windows and Linux", () => {
    expect(
      resolveCustomTitleBarWindowOptions({
        useCustomTitleBar: true,
        platform: "win32",
        isDark: true,
      }),
    ).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#171e26",
        symbolColor: "#e2e2e2",
        height: 36,
      },
    });

    expect(
      resolveCustomTitleBarWindowOptions({
        useCustomTitleBar: true,
        platform: "linux",
        isDark: false,
      }),
    ).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#f4f4f5",
        symbolColor: "#1a1c1c",
        height: 36,
      },
    });
  });

  it("uses native window chrome on unsupported custom-titlebar platforms", () => {
    expect(
      resolveCustomTitleBarWindowOptions({
        useCustomTitleBar: true,
        platform: "freebsd",
        isDark: true,
      }),
    ).toEqual({});
  });

  it("syncs titlebar overlay only on Windows and Linux", () => {
    expect(shouldSyncTitleBarOverlay("darwin")).toBe(false);
    expect(shouldSyncTitleBarOverlay("win32")).toBe(true);
    expect(shouldSyncTitleBarOverlay("linux")).toBe(true);
    expect(shouldSyncTitleBarOverlay("freebsd")).toBe(false);
  });

  it("builds dark and light overlay palettes", () => {
    expect(buildTitleBarOverlay(true)).toEqual({
      color: "#171e26",
      symbolColor: "#e2e2e2",
      height: 36,
    });
    expect(buildTitleBarOverlay(false)).toEqual({
      color: "#f4f4f5",
      symbolColor: "#1a1c1c",
      height: 36,
    });
  });
});
