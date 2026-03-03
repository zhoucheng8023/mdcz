import { JavdbCrawler } from "@main/services/crawler/sites/javdb";

import { Website } from "@shared/enums";
import { describe, expect, it } from "vitest";

import { FixtureNetworkClient, withGateway } from "./fixtures";

describe("JavdbCrawler", () => {
  it("parses search + detail pages into CrawlerData", async () => {
    const number = "SSIS-243";

    const searchUrl = `https://javdb.com/search?q=${encodeURIComponent(number)}&locale=zh`;
    const detailUrl = "https://javdb.com/v/abcd1";

    const searchHtml = `
      <html><body>
        <a class="box" href="/v/abcd1">
          <div class="video-title"><strong>${number} Something</strong></div>
          <div class="meta">meta text</div>
        </a>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <h2 class="title is-4">
          <strong class="current-title">The JavDB Title</strong>
          <span class="origin-title">Original</span>
        </h2>

        <a class="button is-white copy-to-clipboard" data-clipboard-text="${number}">copy</a>

        <div class="panel-block">
          <strong>類別:</strong>
          <span><a>TagA</a><a>TagB</a></span>
        </div>

        <div class="panel-block">
          <strong>片商:</strong>
          <span><a>MakerA</a></span>
        </div>
        <div class="panel-block">
          <strong>發行:</strong>
          <span><a>PublisherA</a></span>
        </div>
        <div class="panel-block">
          <strong>系列:</strong>
          <span><a>SeriesA</a></span>
        </div>
        <div class="panel-block">
          <strong>導演:</strong>
          <span><a>DirectorA</a></span>
        </div>
        <div class="panel-block">
          <strong>日期:</strong>
          <span>2021/02/03</span>
        </div>
        <div class="panel-block">
          <strong>時長:</strong>
          <span>135 minute(s)</span>
        </div>

        <span><strong class="female"></strong><a>Actor1</a><a>Actor2</a></span>

        <img class="video-cover" src="/covers/cover1.jpg" />

        <video id="preview-video"><source src="//cdn.example.com/trailer.mp4" /></video>

        <div class="tile-images preview-images">
          <a class="tile-item" href="/images/1.jpg">1</a>
          <a class="tile-item" href="https://javdb.com/images/2.jpg">2</a>
        </div>
      </body></html>
    `;

    const fixtures = new Map<string, string>([
      [searchUrl, searchHtml],
      [detailUrl, detailHtml],
    ]);
    const networkClient = new FixtureNetworkClient(fixtures);
    const crawler = new JavdbCrawler(withGateway(networkClient));

    const response = await crawler.crawl({
      number,
      site: Website.JAVDB,
      options: {
        cookies: "javdb=cookie",
      },
    });

    expect(response.result.success).toBe(true);
    if (!response.result.success) {
      throw new Error("expected success");
    }

    const data = response.result.data;
    expect(data.website).toBe(Website.JAVDB);
    expect(data.number).toBe(number);
    expect(data.title).toBe("The JavDB Title");
    expect(data.actors).toEqual(["Actor1", "Actor2"]);
    expect(data.genres).toEqual(["TagA", "TagB"]);
    expect(data.studio).toBe("MakerA");
    expect(data.publisher).toBe("PublisherA");
    expect(data.series).toBe("SeriesA");
    expect(data.director).toBe("DirectorA");
    expect(data.release_date).toBe("2021-02-03");
    expect(data.cover_url).toBe("https://javdb.com/covers/cover1.jpg");
    expect(data.poster_url).toBe("https://javdb.com/thumbs/cover1.jpg");
    expect(data.trailer_url).toBe("https://cdn.example.com/trailer.mp4");
    expect(data.sample_images).toEqual(["https://javdb.com/images/1.jpg", "https://javdb.com/images/2.jpg"]);
  });
});
