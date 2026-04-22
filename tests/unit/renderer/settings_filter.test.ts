import {
  getVisibleEntries,
  parseSettingsQuery,
  type SettingsFilterState,
} from "@renderer/components/settings/settingsFilter";
import { FIELD_REGISTRY } from "@renderer/components/settings/settingsRegistry";
import { describe, expect, it } from "vitest";

function buildState(query: string, options?: Partial<Omit<SettingsFilterState, "parsedQuery">>): SettingsFilterState {
  return {
    parsedQuery: parseSettingsQuery(query),
    showAdvanced: false,
    modifiedKeys: new Set<string>(),
    ...options,
  };
}

describe("settingsFilter", () => {
  it("keeps advanced settings hidden during ordinary browse mode", () => {
    const visibleKeys = new Set(getVisibleEntries(FIELD_REGISTRY, buildState("")).map((entry) => entry.key));

    expect(visibleKeys.has("naming.releaseRule")).toBe(false);
    expect(visibleKeys.has("paths.mediaPath")).toBe(true);
  });

  it("@advanced reveals advanced settings without changing the grouped ordering", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@advanced"));

    expect(visibleEntries.find((entry) => entry.key === "naming.releaseRule")).toBeTruthy();
    expect(visibleEntries.find((entry) => entry.key === "translate.llmPrompt")).toBeTruthy();
  });

  it("@id targets advanced settings directly even when advanced browse mode is off", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@id:naming.releaseRule"));

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["naming.releaseRule"]);
  });

  it("@modified can surface advanced settings that diverge from defaults", () => {
    const visibleEntries = getVisibleEntries(
      FIELD_REGISTRY,
      buildState("@modified", {
        modifiedKeys: new Set(["naming.releaseRule", "paths.mediaPath"]),
      }),
    );

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["paths.mediaPath", "naming.releaseRule"]);
  });

  it("composes text and group filters with AND semantics", () => {
    const visibleEntries = getVisibleEntries(FIELD_REGISTRY, buildState("@group:系统 日志"));

    expect(visibleEntries.map((entry) => entry.key)).toEqual(["ui.showLogsPanel"]);
  });
});
