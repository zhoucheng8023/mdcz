import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { configurationSchema, defaultConfiguration } from "@main/services/config";
import { checkConnection, JellyfinActorInfoService, JellyfinActorPhotoService } from "@main/services/jellyfin";
import { buildActorSourceIndex } from "@main/services/jellyfin/people";
import type { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { NfoGenerator } from "@main/services/scraper/NfoGenerator";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-jellyfin-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createConfig = (overrides: Record<string, unknown> = {}) =>
  configurationSchema.parse({
    ...defaultConfiguration,
    ...overrides,
  });

class FakeNetworkClient {
  readonly getJson = vi.fn(async (_url: string) => ({}));
  readonly getContent = vi.fn(async (_url: string) => new Uint8Array());
  readonly postContent = vi.fn(async (_url: string, _body: Uint8Array) => undefined);
  readonly postText = vi.fn(async (_url: string, _body: string) => "");
}

const createCrawlerData = (overrides: Partial<CrawlerData> = {}): CrawlerData => ({
  title: "Sample",
  number: "ABC-123",
  actors: ["Actor A"],
  actor_profiles: [
    {
      name: "Actor A",
      aliases: ["Alias A"],
      description: "Actor biography",
      cover_url: "thumbs/actor-a.jpg",
    },
  ],
  genres: [],
  sample_images: [],
  website: Website.DMM,
  ...overrides,
});

describe("Jellyfin services", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map(async (dirPath) => {
        await rm(dirPath, { recursive: true, force: true });
      }),
    );
  });

  it("returns layered diagnostics for a healthy Jellyfin connection", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Jellyfin", Version: "10.11.2" };
      }
      if (path === "/Users/Me") {
        return { Id: "user-1" };
      }
      if (path === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "" }] };
      }
      if (path === "/Items/person-1/MetadataEditor") {
        return {};
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(
      networkClient as unknown as NetworkClient,
      createConfig({
        server: {
          ...defaultConfiguration.server,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.serverInfo).toEqual({ serverName: "Jellyfin", version: "10.11.2" });
    expect(result.steps.map((step) => [step.key, step.status])).toEqual([
      ["server", "ok"],
      ["auth", "ok"],
      ["peopleRead", "ok"],
      ["peopleWrite", "ok"],
    ]);
  });

  it("marks auth failure and skips people checks when /Users/Me is unauthorized", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Jellyfin", Version: "10.11.2" };
      }
      if (path === "/Users/Me") {
        throw new Error(`HTTP 401 Unauthorized for ${url}`);
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(
      networkClient as unknown as NetworkClient,
      createConfig({
        server: {
          ...defaultConfiguration.server,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.steps.map((step) => [step.key, step.status])).toEqual([
      ["server", "ok"],
      ["auth", "error"],
      ["peopleRead", "skipped"],
      ["peopleWrite", "skipped"],
    ]);
  });

  it("classifies /Users/Me server errors as service failures instead of auth failures", async () => {
    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === "/System/Info/Public") {
        return { ServerName: "Jellyfin", Version: "10.11.2" };
      }
      if (path === "/Users/Me") {
        throw new Error(`HTTP 500 Internal Server Error for ${url}`);
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const result = await checkConnection(
      networkClient as unknown as NetworkClient,
      createConfig({
        server: {
          ...defaultConfiguration.server,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.steps[1]).toMatchObject({
      key: "auth",
      status: "error",
      code: "JELLYFIN_UNREACHABLE",
    });
  });

  it("builds local actor sources from NFO aliases, biography, and relative thumbs", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "Actor A", "ABC-123");
    const thumbPath = join(movieDir, "thumbs", "actor-a.jpg");
    await mkdir(dirname(thumbPath), { recursive: true });
    await writeFile(thumbPath, "thumb", "utf8");

    const xml = new NfoGenerator().buildXml(createCrawlerData());
    await writeFile(join(movieDir, "ABC-123.nfo"), xml, "utf8");

    const sources = await buildActorSourceIndex(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          mediaPath: root,
        },
      }),
    );

    expect(sources.get("actora")).toMatchObject({
      name: "Actor A",
      aliases: ["Alias A"],
      description: "Actor biography",
      coverUrl: thumbPath,
    });
    expect(sources.get("aliasa")).toMatchObject({
      name: "Actor A",
      description: "Actor biography",
    });
  });

  it("drops missing relative actor thumbs instead of treating them as remote URLs", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "Actor A", "ABC-123");
    await mkdir(movieDir, { recursive: true });

    const xml = new NfoGenerator().buildXml(createCrawlerData());
    await writeFile(join(movieDir, "ABC-123.nfo"), xml, "utf8");

    const sources = await buildActorSourceIndex(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          mediaPath: root,
        },
      }),
    );

    expect(sources.get("actora")).toMatchObject({
      name: "Actor A",
      coverUrl: undefined,
    });
  });

  it("uses local actor overview sources and refreshes the person after a successful update", async () => {
    const root = await createTempDir();
    const movieDir = join(root, "Actor A", "ABC-123");
    await mkdir(movieDir, { recursive: true });
    await writeFile(join(movieDir, "ABC-123.nfo"), new NfoGenerator().buildXml(createCrawlerData()), "utf8");

    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A", Overview: "" }] };
      }
      if (parsed.pathname === "/Items/person-1") {
        return { Id: "person-1", Name: "Actor A" };
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const service = new JellyfinActorInfoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
    });

    const result = await service.run(
      createConfig({
        paths: {
          ...defaultConfiguration.paths,
          mediaPath: root,
        },
        server: {
          ...defaultConfiguration.server,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
          personOverviewSources: ["local"],
          refreshPersonAfterSync: true,
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(networkClient.postText).toHaveBeenCalledTimes(2);
    expect(networkClient.postText.mock.calls[0]?.[0]).toContain("/Items/person-1?");
    expect(networkClient.postText.mock.calls[0]?.[1]).toContain("Actor biography");
    expect(networkClient.postText.mock.calls[1]?.[0]).toContain("/Items/person-1/Refresh");
  });

  it("uploads actor photos as raw bytes and falls back to the indexed image endpoint", async () => {
    const root = await createTempDir();
    const photoPath = join(root, "Actor A.jpg");
    await writeFile(photoPath, "photo-bytes", "utf8");

    const networkClient = new FakeNetworkClient();
    networkClient.getJson.mockImplementation(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/Persons") {
        return { Items: [{ Id: "person-1", Name: "Actor A" }] };
      }
      if (url === "https://example.com/empty-map.json") {
        return { Content: {} };
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    networkClient.postContent
      .mockRejectedValueOnce(
        new Error("HTTP 405 Method Not Allowed for http://127.0.0.1:8096/Items/person-1/Images/Primary"),
      )
      .mockResolvedValueOnce(undefined);

    const service = new JellyfinActorPhotoService({
      signalService: new SignalService(null),
      networkClient: networkClient as unknown as NetworkClient,
      actorMapUrl: "https://example.com/empty-map.json",
    });

    const result = await service.run(
      createConfig({
        server: {
          ...defaultConfiguration.server,
          url: "http://127.0.0.1:8096",
          apiKey: "token",
          actorPhotoFolder: root,
          refreshPersonAfterSync: true,
        },
      }),
      "all",
    );

    expect(result).toEqual({ processedCount: 1, failedCount: 0 });
    expect(networkClient.postContent).toHaveBeenCalledTimes(2);
    expect(networkClient.postText).toHaveBeenCalledTimes(1);
    expect(networkClient.postText.mock.calls[0]?.[0]).toContain("/Items/person-1/Refresh");

    const [firstUrl, firstBody] = networkClient.postContent.mock.calls[0];
    const [secondUrl] = networkClient.postContent.mock.calls[1];
    expect(firstUrl).toContain("/Items/person-1/Images/Primary");
    expect(secondUrl).toContain("/Items/person-1/Images/Primary/0");
    expect(Buffer.from(firstBody as Uint8Array)).toEqual(await readFile(photoPath));
  });
});
