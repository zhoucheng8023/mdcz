import { buildAutoSaveFlatPayload, mergeConfigWithFlatPayload } from "@renderer/hooks/useAutoSaveField";
import { describe, expect, it } from "vitest";

describe("useAutoSaveField helpers", () => {
  it("includes the current field plus unresolved server-error fields in the next save payload", () => {
    const payload = buildAutoSaveFlatPayload(
      "translate.llmApiKey",
      "secret",
      {
        translate: {
          engine: { type: "server", message: "缺少 API Key" },
          llmApiKey: { type: "server", message: "缺少 API Key" },
        },
      },
      (fieldPath) => {
        if (fieldPath === "translate.engine") {
          return "openai";
        }
        return undefined;
      },
    );

    expect(payload).toMatchObject({
      "translate.engine": "openai",
      "translate.llmApiKey": "secret",
    });
  });

  it("keeps dynamic site config paths when resubmitting server-error fields", () => {
    const payload = buildAutoSaveFlatPayload(
      "scrape.siteConfigs.javdb.customUrl",
      "https://mirror.example",
      {
        scrape: {
          siteConfigs: {
            javdb: {
              customUrl: { type: "server", message: "URL 无效" },
            },
          },
        },
      },
      () => undefined,
    );

    expect(payload).toEqual({
      "scrape.siteConfigs.javdb.customUrl": "https://mirror.example",
    });
  });

  it("merges flat save payloads back into the nested config cache shape", () => {
    expect(
      mergeConfigWithFlatPayload(
        {
          naming: {
            folderTemplate: "{actor}/{number}",
          },
          scrape: {
            siteConfigs: {
              javdb: {
                customUrl: "",
              },
            },
          },
        },
        {
          "naming.folderTemplate": "{number}",
          "scrape.siteConfigs.javdb.customUrl": "https://mirror.example",
        },
      ),
    ).toEqual({
      naming: {
        folderTemplate: "{number}",
      },
      scrape: {
        siteConfigs: {
          javdb: {
            customUrl: "https://mirror.example",
          },
        },
      },
    });
  });
});
