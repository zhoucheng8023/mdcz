import type { Configuration } from "@main/services/config";
import type { CrawlerProvider } from "@main/services/crawler";
import { loggerService } from "@main/services/LoggerService";
import { Website } from "@shared/enums";
import type { CrawlerData } from "@shared/types";
import { buildCrawlerOptions } from "../crawlerOptions";
import { FieldAggregator } from "./FieldAggregator";
import type { AggregationResult, AggregationStats, SiteCrawlResult } from "./types";

interface CacheEntry {
  result: AggregationResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FC2_SITE_WHITELIST = new Set<Website>([Website.FC2, Website.JAVDB]);
const FC2_NUMBER_PATTERN = /^FC2-?\d+$/iu;

export class AggregationService {
  private readonly logger = loggerService.getLogger("AggregationService");
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly crawlerProvider: CrawlerProvider) {}

  async aggregate(number: string, config: Configuration, signal?: AbortSignal): Promise<AggregationResult | null> {
    const cacheKey = number;
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.info(`Cache hit for ${number}`);
      return cached;
    }

    const enabledSites = this.resolveActiveSites(number, config);
    if (enabledSites.length === 0) {
      this.logger.warn(`No active sites for ${number}`);
      return null;
    }

    this.logger.info(`Aggregating ${number} from ${enabledSites.length} sites: ${enabledSites.join(", ")}`);

    const globalStart = Date.now();
    const { maxParallelCrawlers, perCrawlerTimeoutMs, globalTimeoutMs } = config.aggregation;

    // Execute all crawlers in parallel with semaphore and global timeout
    const siteResults = await this.executeWithGlobalTimeout(
      enabledSites,
      number,
      config,
      maxParallelCrawlers,
      perCrawlerTimeoutMs,
      globalTimeoutMs,
      signal,
    );

    const totalElapsedMs = Date.now() - globalStart;

    // Partition into successes and failures
    const successes = new Map<Website, CrawlerData>();
    let successCount = 0;
    let failedCount = 0;

    for (const result of siteResults) {
      if (result.success && result.data) {
        successes.set(result.site, result.data);
        successCount++;
      } else {
        failedCount++;
      }
    }

    this.logger.info(
      `Crawl complete for ${number}: ${successCount} succeeded, ${failedCount} failed in ${totalElapsedMs}ms`,
    );

    const stats: AggregationStats = {
      totalSites: enabledSites.length,
      successCount,
      failedCount,
      siteResults,
      totalElapsedMs,
    };

    if (successes.size === 0) {
      this.logger.warn(`No successful crawls for ${number}`);
      return null;
    }

    // Aggregate fields from all successful sources
    const aggregator = new FieldAggregator(config.aggregation.fieldPriorities, config.aggregation.behavior);
    const { data, sources, imageAlternatives } = aggregator.aggregate(successes);

    // Validate minimum threshold: number + title + (cover_url OR poster_url)
    if (!data.number || !data.title || (!data.cover_url && !data.poster_url)) {
      this.logger.warn(
        `Aggregated data for ${number} does not meet minimum threshold (number=${!!data.number}, title=${!!data.title}, cover=${!!data.cover_url}, poster=${!!data.poster_url})`,
      );
      return null;
    }

    const result: AggregationResult = { data, sources, imageAlternatives, stats };

    this.putInCache(cacheKey, result);
    return result;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private resolveActiveSites(number: string, config: Configuration): Website[] {
    const enabledSet = new Set(config.scrape.enabledSites);
    const ordered = config.scrape.siteOrder.filter((site) => enabledSet.has(site));
    const isFc2 = FC2_NUMBER_PATTERN.test(number.trim().toUpperCase());
    const candidates = isFc2 ? ordered.filter((site) => FC2_SITE_WHITELIST.has(site)) : ordered;

    if (isFc2) {
      this.logger.info(`FC2 number detected for ${number}; limiting sites to: ${candidates.join(", ") || "(none)"}`);
    }

    // Filter out sites with open circuit breakers
    return candidates.filter((site) => {
      const state = this.crawlerProvider.getCircuitState(site);
      if (state === "open") {
        this.logger.info(`Skipping ${site}: circuit breaker open`);
        return false;
      }
      return true;
    });
  }

  private async executeWithGlobalTimeout(
    sites: Website[],
    number: string,
    config: Configuration,
    maxConcurrent: number,
    perCrawlerTimeoutMs: number,
    globalTimeoutMs: number,
    signal?: AbortSignal,
  ): Promise<SiteCrawlResult[]> {
    const abortController = new AbortController();
    const combinedSignal = signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal;

    const globalTimer = setTimeout(() => {
      this.logger.warn(`Global timeout (${globalTimeoutMs}ms) reached for ${number}`);
      abortController.abort();
    }, globalTimeoutMs);

    try {
      return await this.executeCrawlers(sites, number, config, maxConcurrent, perCrawlerTimeoutMs, combinedSignal);
    } finally {
      clearTimeout(globalTimer);
    }
  }

  private async executeCrawlers(
    sites: Website[],
    number: string,
    config: Configuration,
    maxConcurrent: number,
    perCrawlerTimeoutMs: number,
    signal: AbortSignal,
  ): Promise<SiteCrawlResult[]> {
    const results: SiteCrawlResult[] = [];
    let running = 0;
    let nextIndex = 0;

    return new Promise((resolve) => {
      const tryLaunchNext = (): void => {
        while (running < maxConcurrent && nextIndex < sites.length) {
          const site = sites[nextIndex++];
          running++;

          this.crawlSite(site, number, config, perCrawlerTimeoutMs, signal)
            .then((result) => {
              results.push(result);
            })
            .catch((err) => {
              // Should not happen since crawlSite catches internally
              results.push({
                site,
                success: false,
                error: err instanceof Error ? err.message : String(err),
                elapsedMs: 0,
              });
            })
            .finally(() => {
              running--;
              if (results.length === sites.length) {
                resolve(results);
              } else {
                tryLaunchNext();
              }
            });
        }

        // If no sites at all
        if (sites.length === 0) {
          resolve(results);
        }
      };

      tryLaunchNext();
    });
  }

  private async crawlSite(
    site: Website,
    number: string,
    config: Configuration,
    perCrawlerTimeoutMs: number,
    signal: AbortSignal,
  ): Promise<SiteCrawlResult> {
    const start = Date.now();
    const options = buildCrawlerOptions({ site, configuration: config, signal });
    const configuredTimeoutMs = options.timeoutMs ?? perCrawlerTimeoutMs;
    options.timeoutMs = Math.max(1, Math.min(configuredTimeoutMs, perCrawlerTimeoutMs));

    try {
      const response = await this.crawlerProvider.crawl({
        number,
        site,
        options,
      });

      const elapsedMs = Date.now() - start;

      if (response.result.success) {
        const data = response.result.data;
        this.logger.info(`${site} succeeded for ${number} in ${elapsedMs}ms`);
        return {
          site,
          success: true,
          data: {
            ...data,
            website: data.website ?? site,
            number: data.number || number,
          },
          elapsedMs,
        };
      }

      this.logger.warn(`${site} failed for ${number}: ${response.result.error} (${elapsedMs}ms)`);
      return {
        site,
        success: false,
        error: response.result.error,
        elapsedMs,
      };
    } catch (error) {
      const elapsedMs = Date.now() - start;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`${site} threw for ${number}: ${message} (${elapsedMs}ms)`);
      return {
        site,
        success: false,
        error: message,
        elapsedMs,
      };
    }
  }

  private getFromCache(key: string): AggregationResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  private putInCache(key: string, result: AggregationResult): void {
    // Evict expired entries periodically
    if (this.cache.size > 100) {
      this.evictExpired();
    }

    this.cache.set(key, {
      result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}
