import { configurationSchema } from "@main/services/config";
import { buildCrawlerOptions } from "@main/services/scraper/crawlerOptions";
import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

describe("buildCrawlerOptions", () => {
  it("keeps Cloudflare challenge support disabled by default", () => {
    const configuration = configurationSchema.parse({});

    const options = buildCrawlerOptions({
      site: Website.AVWIKIDB,
      configuration,
    });

    expect(options.cloudflareChallenge).toBeUndefined();
  });

  it("passes Cloudflare challenge options when explicitly enabled", () => {
    const configuration = configurationSchema.parse({
      network: {
        cloudflareChallenge: {
          enabled: true,
          interactiveFallback: false,
          timeout: 45,
        },
      },
    });

    const options = buildCrawlerOptions({
      site: Website.AVWIKIDB,
      configuration,
    });

    expect(options.cloudflareChallenge).toEqual({
      interactiveFallback: false,
      timeoutMs: 45_000,
    });
  });

  it("does not attach Cloudflare challenge options to unsupported sites", () => {
    const configuration = configurationSchema.parse({
      network: {
        cloudflareChallenge: {
          enabled: true,
        },
      },
    });

    const options = buildCrawlerOptions({
      site: Website.DMM,
      configuration,
    });

    expect(options.cloudflareChallenge).toBeUndefined();
  });
});
