import type { Configuration } from "@main/services/config";
import type { CrawlerOptions } from "@main/services/crawler/base/types";
import { supportsCloudflareChallengeSite } from "@main/services/crawler/challenge/supportedSites";
import { Website } from "@shared/enums";

interface BuildCrawlerOptionsInput {
  site: Website;
  configuration: Configuration;
  signal?: AbortSignal;
}

export const buildCrawlerOptions = ({ site, configuration, signal }: BuildCrawlerOptionsInput): CrawlerOptions => {
  const options: CrawlerOptions = {
    timeoutMs: Math.max(1, Math.trunc(configuration.network.timeout * 1000)),
  };
  const siteConfig = configuration.scrape.siteConfigs[site];

  const customUrl = siteConfig?.customUrl?.trim();
  if (customUrl) {
    options.customUrl = customUrl;
  }

  const javdbCookie = configuration.network.javdbCookie.trim();
  if (site === Website.JAVDB && javdbCookie) {
    options.cookies = javdbCookie;
  }

  const javbusCookie = configuration.network.javbusCookie.trim();
  if (site === Website.JAVBUS && javbusCookie) {
    options.cookies = javbusCookie;
  }

  if (configuration.network.cloudflareChallenge.enabled && supportsCloudflareChallengeSite(site)) {
    options.cloudflareChallenge = {
      interactiveFallback: configuration.network.cloudflareChallenge.interactiveFallback,
      timeoutMs: Math.max(1, Math.trunc(configuration.network.cloudflareChallenge.timeout * 1000)),
    };
  }

  if (signal) {
    options.signal = signal;
  }

  return options;
};
