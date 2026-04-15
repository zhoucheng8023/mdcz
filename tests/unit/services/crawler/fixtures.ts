import type { AdapterDependencies } from "@main/services/crawler/base/types";
import { FetchGateway } from "@main/services/crawler/FetchGateway";
import { NetworkClient, type ProbeResult } from "@main/services/network";

type GetTextInit = Parameters<NetworkClient["getText"]>[1];

export const withGateway = (networkClient: NetworkClient): AdapterDependencies => {
  return {
    gateway: new FetchGateway(networkClient),
  };
};

export class FixtureNetworkClient extends NetworkClient {
  private readonly fixtures: Map<string, unknown>;

  readonly requests: Array<{ url: string; headers: Headers }> = [];

  constructor(fixtures: Map<string, unknown>) {
    super({});
    this.fixtures = fixtures;
  }

  private getFixture(url: string): unknown | undefined {
    return this.fixtures.get(url) ?? this.fixtures.get(url.split("?", 1)[0] ?? url);
  }

  override async getText(url: string, init: GetTextInit = {}): Promise<string> {
    this.requests.push({
      url,
      headers: new Headers(init.headers),
    });

    const fixture = this.getFixture(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    if (typeof fixture === "string") {
      return fixture;
    }

    return JSON.stringify(fixture);
  }

  override async getJson<T>(url: string, init: GetTextInit = {}): Promise<T> {
    this.requests.push({
      url,
      headers: new Headers(init.headers),
    });

    const fixture = this.getFixture(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture as T;
  }

  override async postJson<TResponse>(url: string): Promise<TResponse> {
    const fixture = this.getFixture(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture as TResponse;
  }

  override async head(url: string): Promise<{ status: number; ok: boolean }> {
    const fixture = this.getFixture(url);
    if (fixture !== undefined) {
      return { status: 200, ok: true };
    }

    return { status: 404, ok: false };
  }

  override async probe(url: string): Promise<ProbeResult> {
    const fixture = this.getFixture(url);
    if (fixture !== undefined) {
      return {
        ok: true,
        status: 200,
        contentLength: 1,
        resolvedUrl: url,
      };
    }

    return {
      ok: false,
      status: 404,
      contentLength: null,
      resolvedUrl: url,
    };
  }
}

export class StaticFixtureNetworkClient extends NetworkClient {
  constructor(private readonly fixtures: Map<string, string>) {
    super({});
  }

  private getFixture(url: string): string | undefined {
    return this.fixtures.get(url) ?? this.fixtures.get(url.split("?", 1)[0] ?? url);
  }

  override async getText(url: string): Promise<string> {
    const fixture = this.getFixture(url);
    if (!fixture) {
      throw new Error(`Missing fixture for ${url}`);
    }

    return fixture;
  }
}

const parseNumberFromUrl = (url: string): string => {
  const decoded = decodeURIComponent(url).toUpperCase();
  const match = decoded.match(/[A-Z]{2,10}-?\d{2,8}/u);
  return match?.[0] ?? "ABP-123";
};

const parseNumberFromBody = (body: string): string => {
  const decoded = decodeURIComponent(body).toUpperCase();
  const matched = decoded.match(/SN=([A-Z]{2,10}-?\d{2,8})/u);
  return matched?.[1] ?? "ABP-123";
};

const toDmmContentId = (number: string): string => {
  const matched = number.toUpperCase().match(/([A-Z]{2,10})-?(\d{2,8})/u);
  if (!matched) {
    return "1abp00123";
  }

  return `1${matched[1].toLowerCase()}${matched[2].padStart(5, "0")}`;
};

const createSyntheticHtml = (number: string): string => {
  return `
      <html>
        <head>
          <title>${number} Synthetic Title</title>
          <meta property="og:title" content="${number} Synthetic Title" />
          <meta property="og:image" content="https://img.example.com/${number}.jpg" />
          <meta name="description" content="Synthetic plot for ${number}" />
          <meta name="keywords" content="TagA,TagB" />
        </head>
        <body>
          <a href="/detail/${number}">${number}</a>
          <h1 id="title"><span>${number} Synthetic Title</span></h1>
          <table>
            <tr><th>品番</th><td>${number}</td></tr>
            <tr><th>出演者</th><td><a>Actor A</a><a>Actor B</a></td></tr>
            <tr><th>ジャンル</th><td><a>TagA</a><a>TagB</a></td></tr>
            <tr><th>制作</th><td>Studio A</td></tr>
            <tr><th>監督</th><td>Director A</td></tr>
            <tr><th>発売日</th><td>2025-04-10</td></tr>
            <tr><th>収録時間</th><td>120分</td></tr>
          </table>
          <div class="sample"><a href="https://img.example.com/${number}_1.jpg">sample</a></div>
        </body>
      </html>
    `;
};

export class Batch3FixtureNetworkClient extends NetworkClient {
  constructor() {
    super({});
  }

  override async getText(url: string): Promise<string> {
    const number = parseNumberFromUrl(url);

    if (url.includes("tv.dmm.co.jp/list/?")) {
      const contentId = toDmmContentId(number);
      return `<html><body><a href="https://video.dmm.co.jp/av/content/?id=${contentId}">detail</a></body></html>`;
    }

    return createSyntheticHtml(number);
  }

  override async postText(_url: string, body: string): Promise<string> {
    const number = parseNumberFromBody(body);

    return createSyntheticHtml(number);
  }

  override async postJson<TResponse>(url: string): Promise<TResponse> {
    if (url.includes("api.video.dmm.co.jp/graphql")) {
      return {
        data: {
          ppvContent: {
            title: "Synthetic Unified GraphQL Title",
            makerContentId: "ABP-123",
            description: "Synthetic unified graphQL plot",
            makerReleasedAt: "2025-04-10T00:00:00Z",
            duration: 7200,
            sample2DMovie: {
              highestMovieUrl: "https://video.example.com/trailer.mp4",
            },
            sampleImages: [{ largeImageUrl: "https://img.example.com/extra1.jpg" }],
            packageImage: {
              largeUrl: "https://img.example.com/cover.jpg",
              mediumUrl: "https://img.example.com/poster.jpg",
            },
            actresses: [{ name: "Actor A" }],
            directors: [{ name: "Director A" }],
            series: { name: "Series A" },
            maker: { name: "Studio A" },
            label: { name: "Publisher A" },
            genres: [{ name: "TagA" }, { name: "TagB" }],
          },
          reviewSummary: { average: 4.2 },
        },
      } as TResponse;
    }

    if (url.includes("api.tv.dmm.co.jp/graphql")) {
      return {
        data: {
          fanzaTvPlus: {
            content: {
              title: "Synthetic GraphQL Title",
              description: "Synthetic graphQL plot",
              packageImage: "https://img.example.com/poster.jpg",
              packageLargeImage: "https://img.example.com/cover.jpg",
              startDeliveryAt: "2025-04-10T00:00:00Z",
              sampleMovie: {
                url: "https://cc3001.dmm.co.jp/hlsvideo/freepv/s/ssi/ssis00497/playlist.m3u8",
              },
              samplePictures: [{ imageLarge: "https://img.example.com/extra1.jpg" }],
              actresses: [{ name: "Actor A" }],
              directors: [{ name: "Director A" }],
              series: { name: "Series A" },
              maker: { name: "Studio A" },
              label: { name: "Publisher A" },
              genres: [{ name: "TagA" }, { name: "TagB" }],
              reviewSummary: { averagePoint: 4.2 },
              playInfo: { duration: 7200 },
            },
          },
        },
      } as TResponse;
    }

    if (url.includes("api.tv.dmm.com/graphql")) {
      return {
        data: {
          video: {
            titleName: "Synthetic DMM TV Title",
            description: "Synthetic DMM TV plot",
            packageImage: "https://img.example.com/poster.jpg",
            keyVisualImage: "https://img.example.com/cover.jpg",
            startPublicAt: "2025-04-10T00:00:00Z",
            casts: [{ actorName: "Actor A" }],
            staffs: [
              { roleName: "監督", staffName: "Director A" },
              { roleName: "制作", staffName: "Studio A" },
            ],
            genres: [{ name: "TagA" }, { name: "TagB" }],
            reviewSummary: { averagePoint: 4.0 },
          },
        },
      } as TResponse;
    }

    throw new Error(`Missing fixture for ${url}`);
  }
}
