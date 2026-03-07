import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../../base/BaseCrawler";
import type { Context, CrawlerInput } from "../../base/types";
import type { FetchOptions } from "../../FetchGateway";

import { classifyDmmDetailFailure } from "./failureClassifier";
import { buildDmmHttpOptions, normalizeDmmCookieHeader } from "./SessionVault";

const AWS_PLACEHOLDER_KEYWORDS = ["now_printing", "nowprinting", "noimage", "nopic", "media_violation"];

const toAwsProbeUrl = (value: string): string => {
  const url = new URL(value);
  url.searchParams.set("w", "120");
  url.searchParams.set("h", "90");
  return url.toString();
};

const isAwsPlaceholderUrl = (value: string): boolean => {
  const resolvedUrl = value.toLowerCase();
  return AWS_PLACEHOLDER_KEYWORDS.some((keyword) => resolvedUrl.includes(keyword));
};

/**
 * Shared base for DMM and DMM_TV crawlers.
 * Encapsulates cookie management, failure classification,
 * fetch option building, and AWS image optimization.
 */
export abstract class BaseDmmCrawler extends BaseCrawler {
  protected abstract dmmSiteLabel(): "DMM" | "DMM_TV";

  protected override newContext(input: CrawlerInput): Context {
    const context = super.newContext(input);
    context.options.cookies = normalizeDmmCookieHeader(context.options.cookies);
    return context;
  }

  protected override classifyDetailFailure(
    _context: Context,
    detailHtml: string,
    $: CheerioAPI,
    detailUrl: string,
  ): string | null {
    const titleText = $("title").first().text().trim();
    const h1Text = $("h1#title, h1").first().text().trim();
    const mergedTitle = `${titleText} ${h1Text}`.trim() || undefined;

    return classifyDmmDetailFailure({
      html: detailHtml,
      title: mergedTitle,
      detailUrl,
      siteLabel: this.dmmSiteLabel(),
    });
  }

  protected createFetchOptions(context: Context): FetchOptions {
    const headers: Record<string, string> = {};
    if (context.options.referer) {
      headers.referer = context.options.referer;
    }
    if (context.options.userAgent) {
      headers["user-agent"] = context.options.userAgent;
    }

    return buildDmmHttpOptions(context.options.cookies, {
      timeout: context.options.timeoutMs,
      signal: context.options.signal,
      headers,
    });
  }

  protected async optimizeAwsImages(
    data: Partial<CrawlerData>,
    number00?: string,
    numberNo00?: string,
  ): Promise<Partial<CrawlerData>> {
    const coverUrl = data.cover_url;
    if (!coverUrl || !coverUrl.includes("pics.dmm.co.jp")) {
      return data;
    }

    const awsCandidates = [
      coverUrl.replace("pics.dmm.co.jp", "awsimgsrc.dmm.co.jp/pics_dig").replace("/adult/", "/"),
      number00 ? `https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/${number00}/${number00}pl.jpg` : null,
      numberNo00 ? `https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/${numberNo00}/${numberNo00}pl.jpg` : null,
    ].filter((url): url is string => Boolean(url));

    const results = await Promise.all(
      awsCandidates.map(async (awsUrl) => {
        try {
          return (await this.isValidAwsImage(awsUrl)) ? awsUrl : null;
        } catch {
          return null;
        }
      }),
    );

    const validUrl = results.find((url): url is string => url !== null);
    if (validUrl) {
      this.logger.debug(`Using AWS high-quality image: ${validUrl}`);
      return {
        ...data,
        cover_url: validUrl,
        poster_url: validUrl.replace("pl.jpg", "ps.jpg"),
      };
    }

    return data;
  }

  private async isValidAwsImage(awsUrl: string): Promise<boolean> {
    const probe = await this.gateway.probeUrl(toAwsProbeUrl(awsUrl), { method: "GET" });
    return probe.ok && !isAwsPlaceholderUrl(probe.resolvedUrl);
  }
}
