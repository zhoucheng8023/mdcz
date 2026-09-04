import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData } from "@mdcz/shared/types";
import { type RuntimeNetworkClient, type RuntimeRequestInit, runWithNetworkChannel } from "../network";
import { detectLanguage, noopRuntimeLogger, type RuntimeLogger } from "../shared";
import { ActorNameNormalizer } from "./translate/ActorNameNormalizer";
import { GoogleTranslator } from "./translate/engines/GoogleTranslator";
import { LlmApiClient, type RuntimeNetworkJsonResponse } from "./translate/engines/LlmApiClient";
import { type LlmMetadataTranslationResult, OpenAiTranslator } from "./translate/engines/OpenAiTranslator";
import { GenreTranslator } from "./translate/GenreTranslator";
import { ensureTargetChinese, normalizeNewlines, toTranslatedFieldValue } from "./translate/shared";
import { type LanguageTarget, type TranslationMappingStore, toTarget } from "./translate/types";
import { throwIfAborted } from "./utils/abort";

export interface TranslateServiceOptions {
  logger?: RuntimeLogger;
  llmApiClient?: LlmApiClient;
  mappingStore?: TranslationMappingStore;
}

interface TranslationContext {
  field: string;
  number: string;
}

const isLlmApiClientLike = (value: unknown): value is LlmApiClient =>
  typeof value === "object" && value !== null && "generateText" in value && typeof value.generateText === "function";

const createLlmApiClient = (networkClient: RuntimeNetworkClient): LlmApiClient => {
  const postJsonDetailed = networkClient.postJsonDetailed;
  if (typeof postJsonDetailed === "function") {
    return new LlmApiClient({
      postJsonDetailed: async <TResponse>(url: string, payload: unknown, init?: RuntimeRequestInit) => {
        const response = await postJsonDetailed.call(networkClient, url, payload, init);
        return response as RuntimeNetworkJsonResponse<TResponse>;
      },
    });
  }

  return new LlmApiClient();
};

export class TranslateService {
  private readonly logger: RuntimeLogger;

  private readonly actorNameNormalizer: ActorNameNormalizer;

  private readonly openAiTranslator: OpenAiTranslator;

  private readonly googleTranslator: GoogleTranslator;

  private readonly genreTranslator: GenreTranslator;

  constructor(
    private readonly networkClient: RuntimeNetworkClient,
    options: TranslateServiceOptions | LlmApiClient = {},
  ) {
    const resolvedOptions = isLlmApiClientLike(options) ? { llmApiClient: options } : options;
    this.logger = resolvedOptions.logger ?? noopRuntimeLogger;
    this.actorNameNormalizer = new ActorNameNormalizer(resolvedOptions.mappingStore);
    const llmApiClient = resolvedOptions.llmApiClient ?? createLlmApiClient(networkClient);
    this.openAiTranslator = new OpenAiTranslator(this.logger, llmApiClient);
    this.googleTranslator = new GoogleTranslator(this.networkClient, this.logger);
    this.genreTranslator = new GenreTranslator(resolvedOptions.mappingStore);
  }

  async translateCrawlerData(data: CrawlerData, config: Configuration, signal?: AbortSignal): Promise<CrawlerData> {
    if (!config.translate.enableTranslation) {
      return data;
    }

    return await runWithNetworkChannel("translation", async () => {
      throwIfAborted(signal);

      const target = toTarget(config.translate.targetLanguage);

      const mappedActors = await Promise.all(
        (data.actors ?? []).map((actor) => this.actorNameNormalizer.normalizeAlias(actor)),
      );
      const mappedActorProfiles = await Promise.all(
        (data.actor_profiles ?? []).map((profile) => this.actorNameNormalizer.normalizeProfile(profile)),
      );
      let title_zh: string | undefined;
      let plot_zh: string | undefined;
      let mappedGenres: string[];

      if (config.translate.engine === "google") {
        title_zh = toTranslatedFieldValue(
          await this.translateText(data.title, target, config, signal, { field: "title", number: data.number }),
        );
        plot_zh = data.plot
          ? toTranslatedFieldValue(
              await this.translateText(data.plot, target, config, signal, { field: "plot", number: data.number }),
            )
          : undefined;
        mappedGenres = await this.genreTranslator.translateTerms(
          data.genres ?? [],
          target,
          config,
          this.translateText.bind(this),
          async () => null,
          signal,
        );
      } else {
        const prepareField = (input: string | undefined) => {
          const text = normalizeNewlines(input ?? "").trim();
          if (!text) return { source: null, translated: undefined };
          const detected = detectLanguage(text);
          if (detected === target) return { source: null, translated: text };
          if (detected === "zh_cn" || detected === "zh_tw") {
            return { source: null, translated: ensureTargetChinese(text, target) };
          }
          return { source: text, translated: undefined };
        };
        const title = prepareField(data.title);
        const plot = prepareField(data.plot);
        const metadataTranslation: { value: LlmMetadataTranslationResult | null } = { value: null };

        mappedGenres = await this.genreTranslator.translateTerms(
          data.genres ?? [],
          target,
          config,
          this.translateText.bind(this),
          async (genres) => {
            metadataTranslation.value = await this.openAiTranslator.translateMetadata(
              { title: title.source, plot: plot.source, genres },
              target,
              config,
              signal,
            );
            return metadataTranslation.value?.genres ?? null;
          },
          signal,
        );

        title_zh = title.translated;
        plot_zh = plot.translated;
        if (metadataTranslation.value) {
          if (metadataTranslation.value.title) {
            title_zh = toTranslatedFieldValue(ensureTargetChinese(metadataTranslation.value.title, target));
          }
          if (metadataTranslation.value.plot) {
            plot_zh = toTranslatedFieldValue(ensureTargetChinese(metadataTranslation.value.plot, target));
          }
        } else {
          for (const [field, source] of [
            ["title", title.source],
            ["plot", plot.source],
          ] as const) {
            if (source) {
              this.logger.warn(
                `Translation engine failed for ${field} (${data.number}), returning original text: engine returned no translation`,
              );
            }
          }
        }
      }

      throwIfAborted(signal);

      return {
        ...data,
        title_zh,
        plot_zh,
        actors: mappedActors,
        actor_profiles: mappedActorProfiles.length > 0 ? mappedActorProfiles : data.actor_profiles,
        genres: mappedGenres,
      };
    });
  }

  async translateText(
    input: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
    context?: TranslationContext,
  ): Promise<string> {
    const text = normalizeNewlines(input).trim();
    if (!text) {
      return "";
    }

    throwIfAborted(signal);

    const detected = detectLanguage(text);
    if (detected === target) {
      return text;
    }

    if (detected === "zh_cn" || detected === "zh_tw") {
      return ensureTargetChinese(text, target);
    }

    const engine = config.translate.engine;

    if (engine === "google") {
      const google = await this.googleTranslator.translateText(text, target, signal);
      if (google) {
        return ensureTargetChinese(google.trim(), target);
      }
    } else {
      const openAi = await this.openAiTranslator.translateText(text, target, config, signal);
      if (openAi) {
        return ensureTargetChinese(openAi.trim(), target);
      }
    }

    const field = context?.field ?? "text";
    const number = context?.number ?? "unknown";
    this.logger.warn(
      `Translation engine failed for ${field} (${number}), returning original text: engine returned no translation`,
    );
    return text;
  }
}
