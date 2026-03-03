import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";

import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context, CrawlerInput } from "../base/types";
import { toAbsoluteUrl, uniqueStrings } from "./helpers";

const JAV321_BASE_URL = "https://www.jav321.com";

type CheerioInput = Parameters<CheerioAPI>[0];

interface Jav321Context extends Context {
  postBody?: string;
}

export class Jav321Crawler extends BaseCrawler {
  site(): Website {
    return Website.JAV321;
  }

  protected override newContext(input: CrawlerInput): Jav321Context {
    const context = super.newContext(input) as Jav321Context;
    context.postBody = `sn=${encodeURIComponent(input.number)}`;
    return context;
  }

  protected async generateSearchUrl(_context: Jav321Context): Promise<string | null> {
    return `${JAV321_BASE_URL}/search`;
  }

  protected override async fetch(url: string, context: Jav321Context): Promise<string> {
    if (url === `${JAV321_BASE_URL}/search` && context.postBody) {
      const headers = this.buildHeaders(context);
      headers["content-type"] = "application/x-www-form-urlencoded";
      return this.gateway.fetchPostHtml(url, context.postBody, {
        timeout: context.options.timeoutMs,
        signal: context.options.signal,
        headers,
      });
    }

    return super.fetch(url, context);
  }

  protected async parseSearchPage(context: Jav321Context, $: CheerioAPI, _searchUrl: string): Promise<string | null> {
    // JAV321 search redirects to detail page or shows results
    // Check if we're already on a detail page
    const panelHeading = $("div.panel-heading h3").first().text().trim();
    if (panelHeading) {
      return _searchUrl;
    }

    const expected = context.number.toUpperCase().replace(/-/gu, "");

    const candidates = $("a[href*='/video/']")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => Boolean(href));

    for (const href of candidates) {
      const normalized = href.toUpperCase().replace(/-/gu, "");
      if (normalized.includes(expected)) {
        return toAbsoluteUrl(JAV321_BASE_URL, href) ?? null;
      }
    }

    return candidates[0] ? (toAbsoluteUrl(JAV321_BASE_URL, candidates[0]) ?? null) : null;
  }

  protected async parseDetailPage(
    context: Jav321Context,
    $: CheerioAPI,
    _detailUrl: string,
  ): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "div.panel-heading h3");
    if (!titleRaw) {
      return null;
    }

    const title = titleRaw.trim();
    if (!title) {
      return null;
    }

    // Extract metadata from info block
    const infoHtml = $("div.col-md-9").first().html() ?? "";

    const extractField = (label: string): string | undefined => {
      const regex = new RegExp(`<b>${label}</b>\\s*(.+?)(?:<br|<\\/div|$)`, "iu");
      const match = infoHtml.match(regex);
      if (!match?.[1]) {
        return undefined;
      }
      // Strip HTML tags and trim
      const value = match[1].replace(/<[^>]*>/gu, "").trim();
      return value.length > 0 ? value : undefined;
    };

    const extractFieldLinks = (label: string): string[] => {
      const regex = new RegExp(`<b>${label}</b>\\s*(.+?)(?:<br|<\\/div|$)`, "iu");
      const match = infoHtml.match(regex);
      if (!match?.[1]) {
        return [];
      }
      const linkMatches = match[1].matchAll(/<a[^>]*>([^<]+)<\/a>/giu);
      return Array.from(linkMatches)
        .map((m) => m[1]?.trim())
        .filter((v): v is string => Boolean(v) && v.length > 0);
    };

    const number = extractField("品番") ?? context.number;
    const releaseDate = parseDate(extractField("配信開始日") ?? extractField("発売日")) ?? undefined;
    const studio = extractFieldLinks("メーカー")[0];
    const publisher = extractFieldLinks("レーベル")[0] ?? studio;

    const genres = uniqueStrings(
      $("a[href*='/genre/']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim())
        .filter((name: string) => name.length > 0),
    );

    const actors = uniqueStrings(
      $("a[href*='/star/']")
        .toArray()
        .map((element: CheerioInput) => $(element).text().trim())
        .filter((name: string) => name.length > 0),
    );

    const coverUrl = $("img.img-responsive").first().attr("src");
    const coverUrlAbsolute = coverUrl ? toAbsoluteUrl(JAV321_BASE_URL, coverUrl) : undefined;

    const sampleImages = $("a[href*='/snapshot/']")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => Boolean(href))
      .map((href: string) => toAbsoluteUrl(JAV321_BASE_URL, href))
      .filter((url): url is string => Boolean(url));

    // Extract plot - typically in a multi-level div after the info section
    const plot = extractText($, "div.panel-body div.row div.col-md-12") ?? undefined;

    return {
      title,
      number,
      actors,
      genres,
      studio,
      director: undefined,
      publisher,
      series: undefined,
      plot,
      release_date: releaseDate,
      rating: undefined,
      cover_url: coverUrlAbsolute,
      poster_url: undefined,
      fanart_url: undefined,
      sample_images: sampleImages,
      trailer_url: undefined,
      website: Website.JAV321,
    };
  }
}
