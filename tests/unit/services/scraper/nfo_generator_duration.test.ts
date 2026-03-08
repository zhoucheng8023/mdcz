import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { parseNfo } from "@main/utils/nfo";
import { Website } from "@shared/enums";
import type { CrawlerData, DownloadedAssets } from "@shared/types";
import { describe, expect, it } from "vitest";

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: [],
  genres: [],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

const createAssets = (): DownloadedAssets => ({
  cover: "/tmp/out/cover.jpg",
  poster: "/tmp/out/poster.jpg",
  fanart: "/tmp/out/fanart.jpg",
  trailer: "/tmp/out/trailer.mp4",
  sceneImages: ["/tmp/out/samples/scene-001.jpg"],
  downloaded: [
    "/tmp/out/cover.jpg",
    "/tmp/out/poster.jpg",
    "/tmp/out/fanart.jpg",
    "/tmp/out/trailer.mp4",
    "/tmp/out/samples/scene-001.jpg",
  ],
});

describe("NfoGenerator", () => {
  it("uses crawler duration when local video metadata is unavailable", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
    );

    expect(xml).toContain("<runtime>90</runtime>");
  });

  it("prefers local video metadata duration over crawler duration", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        durationSeconds: 5400,
      }),
      {
        videoMeta: {
          durationSeconds: 3600,
          width: 1920,
          height: 1080,
        },
      },
    );

    expect(xml).toContain("<runtime>60</runtime>");
  });

  it("prefers local assets and preserves actor thumbs in the generated XML", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        actors: ["Actor A"],
        actor_profiles: [
          {
            name: "Actor A",
            aliases: ["Alias A"],
            description: "Actor biography",
            cover_url: "https://img.example.com/actor-a.jpg",
          },
        ],
        genres: ["Drama"],
        studio: "Studio",
        director: "Director",
        series: "Series",
        plot: "Plot",
        release_date: "2024-01-02",
      }),
      {
        assets: createAssets(),
      },
    );

    expect(xml).toContain('<thumb aspect="poster">poster.jpg</thumb>');
    expect(xml).toContain('<thumb aspect="thumb">cover.jpg</thumb>');
    expect(xml).toContain("<fanart>");
    expect(xml).toContain("<thumb>fanart.jpg</thumb>");
    expect(xml).toContain("<thumb>samples/scene-001.jpg</thumb>");
    expect(xml).toContain("<trailer>trailer.mp4</trailer>");
    expect(xml).toContain("<releasedate>2024-01-02</releasedate>");
    expect(xml).toContain("<name>Actor A</name>");
    expect(xml).toContain("<altname>Alias A</altname>");
    expect(xml).toContain("<biography>Actor biography</biography>");
    expect(xml).toContain("<thumb>https://img.example.com/actor-a.jpg</thumb>");
  });

  it("round-trips Jellyfin-supported set and release date fields", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        series: "Collection",
        release_date: "2024-01-02",
      }),
    );

    const parsed = parseNfo(xml);

    expect(parsed.series).toBe("Collection");
    expect(parsed.release_date).toBe("2024-01-02");
  });

  it("preserves local poster, cover, fanart, trailer, and sample image references when parsed back", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        poster_url: "https://remote.example.com/poster.jpg",
        cover_url: "https://remote.example.com/cover.jpg",
        fanart_url: "https://remote.example.com/fanart.jpg",
        trailer_url: "https://remote.example.com/trailer.mp4",
      }),
      {
        assets: createAssets(),
      },
    );

    const parsed = parseNfo(xml);

    expect(parsed.poster_url).toBe("poster.jpg");
    expect(parsed.cover_url).toBe("cover.jpg");
    expect(parsed.fanart_url).toBe("fanart.jpg");
    expect(parsed.trailer_url).toBe("trailer.mp4");
    expect(parsed.sample_images).toEqual(["samples/scene-001.jpg"]);
  });

  it("round-trips actor aliases and biography from NFO actor nodes", () => {
    const xml = new NfoGenerator().buildXml(
      createCrawlerData({
        actors: ["Actor A"],
        actor_profiles: [
          {
            name: "Actor A",
            aliases: ["Alias A"],
            description: "Actor biography",
          },
        ],
      }),
    );

    const parsed = parseNfo(xml);

    expect(parsed.actor_profiles).toEqual([
      expect.objectContaining({
        name: "Actor A",
        aliases: ["Alias A"],
        description: "Actor biography",
      }),
    ]);
  });
});
