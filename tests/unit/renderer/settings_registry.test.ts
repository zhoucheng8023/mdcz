import { FIELD_REGISTRY, flattenConfig, unflattenConfig } from "@renderer/components/settings/settingsRegistry";
import { describe, expect, it } from "vitest";

describe("settingsRegistry", () => {
  it("exposes the cross-field validation source and target under the same anchor", () => {
    // prd.md §R2 canonical case: toggling translate.engine to "openai" with an
    // empty translate.llmApiKey must surface a banner on the owning section.
    // For the banner to collect the error, both fields must share the anchor.
    const engine = FIELD_REGISTRY.find((entry) => entry.key === "translate.engine");
    const llmApiKey = FIELD_REGISTRY.find((entry) => entry.key === "translate.llmApiKey");

    expect(engine?.anchor).toBe("dataSources");
    expect(llmApiKey?.anchor).toBe("dataSources");
  });

  it("round-trips nested config through flatten + unflatten without losing registered fields", () => {
    const source = {
      translate: {
        engine: "openai",
        llmApiKey: "secret",
      },
      naming: {
        folderTemplate: "{actor}/{number}",
        fileTemplate: "{number}",
      },
      scrape: {
        sites: ["javdb"],
        siteConfigs: {
          javdb: { customUrl: "https://example.org" },
        },
      },
    };

    const flat = flattenConfig(source);
    expect(flat["translate.engine"]).toBe("openai");
    expect(flat["translate.llmApiKey"]).toBe("secret");
    expect(flat["naming.folderTemplate"]).toBe("{actor}/{number}");
    expect(flat["scrape.siteConfigs.javdb.customUrl"]).toBe("https://example.org");

    const roundTripped = unflattenConfig(flat);
    expect(roundTripped).toMatchObject({
      translate: { engine: "openai", llmApiKey: "secret" },
      naming: { folderTemplate: "{actor}/{number}", fileTemplate: "{number}" },
      scrape: { siteConfigs: { javdb: { customUrl: "https://example.org" } } },
    });
  });

  it("unflatten builds nested objects for single-field auto-save payloads", () => {
    // useAutoSaveField saves one field at a time: it passes { [path]: value } to
    // unflattenConfig before sending to ipc.config.save. Make sure dotted paths
    // with dynamic segments (site customUrls) nest correctly.
    const payload = unflattenConfig({ "scrape.siteConfigs.javdb.customUrl": "https://mirror.example" });
    expect(payload).toMatchObject({
      scrape: { siteConfigs: { javdb: { customUrl: "https://mirror.example" } } },
    });
  });
});
