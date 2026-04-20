import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CrawlerProvider, FetchGateway } from "@main/services/crawler";
import { NetworkClient } from "@main/services/network";
import { SignalService } from "@main/services/SignalService";
import { ScraperService } from "@main/services/scraper/ScraperService";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

const createTempDir = async (): Promise<string> => {
  const dirPath = await mkdtemp(join(tmpdir(), "mdcz-scraper-service-"));
  tempDirs.push(dirPath);
  return dirPath;
};

const createService = (): ScraperService => {
  const signalService = new SignalService(null);
  const networkClient = new NetworkClient();
  const crawlerProvider = new CrawlerProvider({
    fetchGateway: new FetchGateway(networkClient),
  });
  return new ScraperService(signalService, networkClient, crawlerProvider);
};

describe("ScraperService path filtering", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0, tempDirs.length).map((dirPath) => rm(dirPath, { recursive: true, force: true })),
    );
  });

  it("resolves selected files directly without treating paths as directories", async () => {
    const root = await createTempDir();
    const firstFilePath = join(root, "ABC-123.mp4");
    const secondFilePath = join(root, "nested", "DEF-456.mkv");

    await mkdir(join(root, "nested"), { recursive: true });
    await writeFile(firstFilePath, "", "utf8");
    await writeFile(secondFilePath, "", "utf8");
    await writeFile(join(root, "ignore.txt"), "", "utf8");

    const filePaths = await (
      createService() as unknown as {
        resolveSelectedFilePaths: (paths: string[]) => Promise<string[]>;
      }
    ).resolveSelectedFilePaths([firstFilePath, secondFilePath, firstFilePath, join(root, "ignore.txt")]);

    expect(filePaths).toEqual([firstFilePath, secondFilePath]);
  });
});
