import { normalizeText } from "@main/utils/normalization";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import type { CheerioAPI } from "cheerio";
import { BaseCrawler } from "../base/BaseCrawler";
import { extractText, parseDate } from "../base/parser";
import type { Context } from "../base/types";
import { extractParentTextByLabelSelector, pickSearchResultDetailUrl, toAbsoluteUrl } from "./helpers";

const AVSOX_BASE_URL = "https://avsox.click";

type CheerioInput = Parameters<CheerioAPI>[0];

export class AvsoxCrawler extends BaseCrawler {
  site(): Website {
    return Website.AVSOX;
  }

  protected override buildHeaders(context: Context): Record<string, string> {
    return {
      ...super.buildHeaders(context),
      "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7,ja;q=0.6",
    };
  }

  protected async generateSearchUrl(context: Context): Promise<string | null> {
    const number = normalizeText(context.number);
    if (!number) {
      return null;
    }

    const base = this.resolveBaseUrl(context, AVSOX_BASE_URL);
    return `${base}/cn/search/${encodeURIComponent(number)}`;
  }

  protected async parseSearchPage(context: Context, $: CheerioAPI, _searchUrl: string): Promise<string | null> {
    const candidateHrefs = $("a.movie-box")
      .toArray()
      .map((element: CheerioInput) => $(element).attr("href"))
      .filter((href: string | undefined): href is string => typeof href === "string" && href.length > 0);

    const base = this.resolveBaseUrl(context, AVSOX_BASE_URL);

    // Match by number in the date element (contains the video code)
    for (const href of candidateHrefs) {
      const box = $(`a.movie-box[href="${href}"]`);
      const code = box.find("date").first().text().trim();
      if (code && normalizeText(code) === normalizeText(context.number)) {
        return toAbsoluteUrl(base, href) ?? null;
      }
    }

    return pickSearchResultDetailUrl(base, candidateHrefs, context.number);
  }

  protected async parseDetailPage(context: Context, $: CheerioAPI, _detailUrl: string): Promise<CrawlerData | null> {
    const titleRaw = extractText($, "h3");
    if (!titleRaw) {
      return null;
    }

    const base = this.resolveBaseUrl(context, AVSOX_BASE_URL);

    const number =
      extractText($, "div.col-md-3.info span[style*='color:#CC0000']") ??
      extractParentTextByLabelSelector($, "span.header", ["识别码", "識別碼", "ID"]) ??
      context.number;

    const release =
      parseDate(extractParentTextByLabelSelector($, "span.header", ["发行时间", "發行時間", "Released"])) ?? undefined;

    const studio = $("a[href*='/studio/']").first().text().trim() || undefined;
    const series = $("a[href*='/series/']").first().text().trim() || undefined;

    const genres = $("span.genre a[href*='/genre/']")
      .map((_index: number, element: CheerioInput) => $(element).text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    const actors = $("#avatar-waterfall a.avatar-box")
      .map((_index: number, element: CheerioInput) => $(element).find("span").text().trim())
      .get()
      .filter((name: string) => name.length > 0);

    const thumbUrl = $("a.bigImage").first().attr("href") ?? $("a.bigImage img").first().attr("src") ?? undefined;
    const thumbUrlAbsolute = toAbsoluteUrl(base, thumbUrl);

    const title = titleRaw.replace(number, "").trim();

    return {
      title,
      number,
      actors,
      genres,
      studio,
      director: undefined,
      publisher: undefined,
      series,
      plot: undefined,
      release_date: release,
      rating: undefined,
      thumb_url: thumbUrlAbsolute,
      poster_url: undefined,
      fanart_url: undefined,
      scene_images: [],
      trailer_url: undefined,
      website: Website.AVSOX,
    };
  }
}
