import type { ActorImageService } from "@main/services/ActorImageService";
import type { ActorSourceProvider } from "@main/services/actorSource";
import type { Configuration } from "@main/services/config";
import { loggerService } from "@main/services/LoggerService";
import type { CrawlerData } from "@shared/types";
import { prepareCrawlerDataForNfo } from "./prepareCrawlerDataForNfo";

const logger = loggerService.getLogger("PrepareCrawlerDataForMovieOutput");

export interface PreparedCrawlerDataForMovieOutput {
  data: CrawlerData;
  actorPhotoPaths: string[];
}

export const prepareCrawlerDataForMovieOutput = async (
  actorImageService: ActorImageService,
  configuration: Configuration,
  crawlerData: CrawlerData,
  options: {
    enabled?: boolean;
    movieDir?: string;
    sourceVideoPath: string;
    actorSourceProvider?: ActorSourceProvider;
  },
): Promise<PreparedCrawlerDataForMovieOutput> => {
  if (!options.enabled || !options.movieDir) {
    return {
      data: crawlerData,
      actorPhotoPaths: [],
    };
  }

  try {
    return await prepareCrawlerDataForNfo(actorImageService, configuration, crawlerData, {
      movieDir: options.movieDir,
      sourceVideoPath: options.sourceVideoPath,
      actorSourceProvider: options.actorSourceProvider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to prepare movie output data for ${crawlerData.number || options.sourceVideoPath}: ${message}`);
    return {
      data: crawlerData,
      actorPhotoPaths: [],
    };
  }
};
