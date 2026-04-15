import { JavdbCrawler } from "@main/services/crawler/sites/javdb";
import { type BrowserChallengeResolver, NetworkClient } from "@main/services/network";
import { Website } from "@shared/enums";
import { describe, expect, it, vi } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

type GetTextInit = Parameters<NetworkClient["getText"]>[1];

class CloudflareFixtureNetworkClient extends NetworkClient {
  readonly requests: Array<{ url: string; headers: Headers }> = [];

  constructor(
    private readonly fixtures: Map<string, string>,
    private readonly challengeUrl: string,
  ) {
    super({});
  }

  override async getText(url: string, init: GetTextInit = {}): Promise<string> {
    const headers = new Headers(init.headers);
    this.requests.push({ url, headers });

    if (url === this.challengeUrl && !headers.get("cookie")?.includes("cf_clearance=resolved")) {
      return "<html><body>Cloudflare ray-id challenge</body></html>";
    }

    const fixture = this.fixtures.get(url) ?? this.fixtures.get(url.split("?", 1)[0] ?? url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture;
  }
}

describe("JavdbCrawler", () => {
  it("parses detail pages and keeps only explicitly marked female actors", async () => {
    const cases = [
      {
        number: "SSIS-243",
        searchUrl: "https://javdb.com/search?q=SSIS-243&locale=zh",
        detailUrl: "https://javdb.com/v/abcd1",
        searchHtml: `
          <html><body>
            <a class="box" href="/v/abcd1">
              <div class="video-title"><strong>SSIS-243 Something</strong></div>
              <div class="meta">meta text</div>
            </a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h2 class="title is-4">
              <strong class="current-title">The JavDB Title</strong>
              <span class="origin-title">Original</span>
            </h2>
            <a class="button is-white copy-to-clipboard" data-clipboard-text="SSIS-243">copy</a>
            <div class="panel-block"><strong>類別:</strong><span><a>TagA</a><a>TagB</a></span></div>
            <div class="panel-block"><strong>片商:</strong><span><a>MakerA</a></span></div>
            <div class="panel-block"><strong>發行:</strong><span><a>PublisherA</a></span></div>
            <div class="panel-block"><strong>系列:</strong><span><a>SeriesA</a></span></div>
            <div class="panel-block"><strong>導演:</strong><span><a>DirectorA</a></span></div>
            <div class="panel-block"><strong>日期:</strong><span>2021/02/03</span></div>
            <div class="panel-block"><strong>時長:</strong><span>135 minute(s)</span></div>
            <div class="panel-block">
              <strong>演員:</strong>
              <span class="value">
                <a>Actor1</a><strong class="symbol female">♀</strong>
                <a>Actor2</a><strong class="symbol female">♀</strong>
              </span>
            </div>
            <img class="video-cover" src="/covers/cover1.jpg" />
            <video id="preview-video"><source src="//cdn.example.com/trailer.mp4" /></video>
            <div class="tile-images preview-images">
              <a class="tile-item" href="/images/1.jpg">1</a>
              <a class="tile-item" href="https://javdb.com/images/2.jpg">2</a>
            </div>
          </body></html>
        `,
        cookies: "javdb=cookie",
        assert: (data: ReturnType<JavdbCrawler["crawl"]> extends Promise<infer T> ? T : never) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.website).toBe(Website.JAVDB);
          expect(data.result.data.number).toBe("SSIS-243");
          expect(data.result.data.title).toBe("The JavDB Title");
          expect(data.result.data.actors).toEqual(["Actor1", "Actor2"]);
          expect(data.result.data.genres).toEqual(["TagA", "TagB"]);
          expect(data.result.data.studio).toBe("MakerA");
          expect(data.result.data.publisher).toBe("PublisherA");
          expect(data.result.data.series).toBe("SeriesA");
          expect(data.result.data.director).toBe("DirectorA");
          expect(data.result.data.release_date).toBe("2021-02-03");
          expect(data.result.data.thumb_url).toBe("https://javdb.com/covers/cover1.jpg");
          expect(data.result.data.poster_url).toBe("https://javdb.com/thumbs/cover1.jpg");
          expect(data.result.data.trailer_url).toBe("https://cdn.example.com/trailer.mp4");
          expect(data.result.data.scene_images).toEqual([
            "https://javdb.com/images/1.jpg",
            "https://javdb.com/images/2.jpg",
          ]);
        },
      },
      {
        number: "ABF-075",
        searchUrl: "https://javdb.com/search?q=ABF-075&locale=zh",
        detailUrl: "https://javdb.com/v/ner5DV",
        searchHtml: `
          <html><body>
            <a class="box" href="/v/ner5DV">
              <div class="video-title"><strong>ABF-075</strong></div>
              <div class="meta">2024-02-08</div>
            </a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h2 class="title is-4">
              <strong class="current-title">ABF-075 Title</strong>
            </h2>
            <a class="button is-white copy-to-clipboard" data-clipboard-text="ABF-075">copy</a>
            <div class="panel-block">
              <strong>演員:</strong>
              <span class="value">
                <a href="/actors/a">吉村卓</a><strong class="symbol male">♂</strong>&nbsp;
                <a href="/actors/b">貞松大輔</a><strong class="symbol male">♂</strong>&nbsp;
                <a href="/actors/c">瀧本雫葉</a><strong class="symbol female">♀</strong>&nbsp;
              </span>
            </div>
          </body></html>
        `,
        cookies: undefined,
        assert: (data: ReturnType<JavdbCrawler["crawl"]> extends Promise<infer T> ? T : never) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.actors).toEqual(["瀧本雫葉"]);
        },
      },
      {
        number: "ABW-123",
        searchUrl: "https://javdb.com/search?q=ABW-123&locale=zh",
        detailUrl: "https://javdb.com/v/fuzzy1",
        searchHtml: `
          <html><body>
            <a class="box" href="/v/fuzzy1">
              <div class="video-title"><strong>Completely Different Title</strong></div>
              <div class="meta">ABW 123 2024-02-08</div>
            </a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h2 class="title is-4">
              <strong class="current-title">ABW-123 Fuzzy Match Title</strong>
            </h2>
            <a class="button is-white copy-to-clipboard" data-clipboard-text="ABW-123">copy</a>
          </body></html>
        `,
        cookies: undefined,
        assert: (data: ReturnType<JavdbCrawler["crawl"]> extends Promise<infer T> ? T : never) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.number).toBe("ABW-123");
          expect(data.result.data.title).toBe("ABW-123 Fuzzy Match Title");
        },
      },
      {
        number: "MIDE-999",
        searchUrl: "https://javdb.com/search?q=MIDE-999&locale=zh",
        detailUrl: "https://javdb.com/v/fallback1",
        searchHtml: `
          <html><body>
            <a class="box" href="/v/fallback1">
              <div class="video-title"><strong>MIDE-999</strong></div>
              <div class="meta">2024-03-01</div>
            </a>
          </body></html>
        `,
        detailHtml: `
          <html><body>
            <h2 class="title is-4">
              <strong class="current-title">MIDE-999 Title</strong>
            </h2>
            <div class="panel-block">
              <strong>演員:</strong>
              <span class="value">
                <a href="/actors/a">Actor A</a>
                <a href="/actors/b">Actor B</a>
              </span>
            </div>
            <div class="panel-block">
              <strong>類別:</strong>
              <span class="value">
                <a href="/tags/a">Tag A</a>
                <a href="/tags/b">Tag B</a>
              </span>
            </div>
          </body></html>
        `,
        cookies: undefined,
        assert: (data: ReturnType<JavdbCrawler["crawl"]> extends Promise<infer T> ? T : never) => {
          if (!data.result.success) {
            throw new Error("expected success");
          }
          expect(data.result.data.actors).toEqual(["Actor A", "Actor B"]);
          expect(data.result.data.genres).toEqual(["Tag A", "Tag B"]);
        },
      },
    ];

    for (const { number, searchUrl, detailUrl, searchHtml, detailHtml, cookies, assert } of cases) {
      const fixtures = new Map<string, string>([
        [searchUrl, searchHtml],
        [detailUrl, detailHtml],
      ]);
      const crawler = new JavdbCrawler(withGateway(new FixtureNetworkClient(fixtures)));

      const response = await crawler.crawl({
        number,
        site: Website.JAVDB,
        options: cookies
          ? {
              cookies,
            }
          : undefined,
      });

      expect(response.result.success).toBe(true);
      assert(response as Awaited<ReturnType<JavdbCrawler["crawl"]>>);
    }
  });

  it("resolves Cloudflare challenge pages through the shared BaseCrawler retry path", async () => {
    const searchUrl = "https://javdb.com/search?q=SSIS-243&locale=zh";
    const detailUrl = "https://javdb.com/v/abcd1";
    const abortController = new AbortController();
    const networkClient = new CloudflareFixtureNetworkClient(
      new Map<string, string>([
        [
          searchUrl,
          `
            <html><body>
              <a class="box" href="/v/abcd1">
                <div class="video-title"><strong>SSIS-243 Something</strong></div>
                <div class="meta">meta text</div>
              </a>
            </body></html>
          `,
        ],
        [
          detailUrl,
          `
            <html><body>
              <h2 class="title is-4"><strong class="current-title">The JavDB Title</strong></h2>
              <a class="button is-white copy-to-clipboard" data-clipboard-text="SSIS-243">copy</a>
            </body></html>
          `,
        ],
      ]),
      searchUrl,
    );
    const browserChallengeResolver: BrowserChallengeResolver = {
      resolve: vi.fn(async (request) => {
        expect(request).toMatchObject({
          url: searchUrl,
          expectedCookieNames: ["cf_clearance"],
          timeoutMs: 10_000,
          interactive: false,
        });
        expect(request.signal).toBe(abortController.signal);

        return {
          cookies: [{ name: "cf_clearance", value: "resolved", domain: "javdb.com", path: "/" }],
          headers: {
            "sec-ch-ua": '"Chromium";v="146"',
            "user-agent": "Mozilla/5.0 Browser Challenge",
          },
        };
      }),
    };
    const crawler = new JavdbCrawler({
      ...withGateway(networkClient),
      browserChallengeResolver,
    });

    const response = await crawler.crawl({
      number: "SSIS-243",
      site: Website.JAVDB,
      options: {
        cloudflareChallenge: {
          interactiveFallback: false,
          timeoutMs: 10_000,
        },
        signal: abortController.signal,
      },
    });

    expect(response.result.success).toBe(true);
    expect(browserChallengeResolver.resolve).toHaveBeenCalledTimes(1);

    const retriedSearchRequest = networkClient.requests.filter((request) => request.url === searchUrl)[1];
    expect(retriedSearchRequest?.headers.get("cookie")).toContain("cf_clearance=resolved");
    expect(retriedSearchRequest?.headers.get("user-agent")).toBe("Mozilla/5.0 Browser Challenge");

    const detailRequest = networkClient.requests.find((request) => request.url === detailUrl);
    expect(detailRequest?.headers.get("cookie")).toContain("cf_clearance=resolved");
    expect(detailRequest?.headers.get("sec-ch-ua")).toBe('"Chromium";v="146"');
  });
});
