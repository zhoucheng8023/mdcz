import type { Configuration } from "@mdcz/shared/config";
import type { CrawlerData } from "@mdcz/shared/types";
import {
  isUnrecoverableNetworkError,
  type RuntimeNetworkClient,
  type RuntimeRequestInit,
  runWithNetworkChannel,
} from "../network";
import { detectLanguage, noopRuntimeLogger, type RuntimeLogger, toErrorMessage } from "../shared";
import { ActorNameNormalizer } from "./translate/ActorNameNormalizer";
import { GoogleTranslator } from "./translate/engines/GoogleTranslator";
import { LlmApiClient, type RuntimeNetworkJsonResponse } from "./translate/engines/LlmApiClient";
import { type LlmMetadataTranslationResult, OpenAiTranslator } from "./translate/engines/OpenAiTranslator";
import { GenreTranslator } from "./translate/GenreTranslator";
import { ensureTargetChinese, normalizeNewlines } from "./translate/shared";
import { type LanguageTarget, type TranslationMappingStore, toTarget } from "./translate/types";
import { isAbortError, throwIfAborted } from "./utils/abort";

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

  async translateCrawlerData(
    data: CrawlerData,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<{ data: CrawlerData; error: string | null }> {
    if (!config.translate.enableTranslation) {
      return { data, error: null };
    }

    return await runWithNetworkChannel("translation", async () => {
      throwIfAborted(signal);

      const target = toTarget(config.translate.targetLanguage);
      const startedAt = Date.now();
      this.logger.info(
        `[translation] number=${data.number} engine=${config.translate.engine} target=${target} model=${config.translate.engine === "google" ? "none" : config.translate.llmModelName} reasoning=${config.translate.engine === "google" ? "none" : config.translate.llmReasoning} titleChars=${data.title.length} plotChars=${data.plot?.length ?? 0} genres=${data.genres?.length ?? 0}`,
      );

      const mappedActors = await Promise.all(
        (data.actors ?? []).map((actor) => this.actorNameNormalizer.normalizeAlias(actor)),
      );
      const mappedActorProfiles = await Promise.all(
        (data.actor_profiles ?? []).map((profile) => this.actorNameNormalizer.normalizeProfile(profile)),
      );
      const prepareField = (input: string | undefined): { source: string | null; translated: string | undefined } => {
        const text = normalizeNewlines(input ?? "").trim();
        if (!text) return { source: null, translated: undefined };
        const detected = detectLanguage(text);
        if (detected === "zh_cn" || detected === "zh_tw") {
          return { source: null, translated: ensureTargetChinese(text, target) };
        }
        return { source: text, translated: undefined };
      };
      const fields = { title: prepareField(data.title), plot: prepareField(data.plot) };
      const metadataTranslation: { value: LlmMetadataTranslationResult | null } = { value: null };

      if (config.translate.engine === "google") {
        metadataTranslation.value = {
          title: fields.title.source
            ? await this.googleTranslator.translateText(fields.title.source, target, signal)
            : null,
          plot: fields.plot.source
            ? await this.googleTranslator.translateText(fields.plot.source, target, signal)
            : null,
          genres: [],
        };
      }
      const mappedGenres = await this.genreTranslator.translateTerms(
        data.genres ?? [],
        target,
        config,
        (text, target, configuration, requestSignal) =>
          this.translateText(text, target, configuration, requestSignal, {
            field: "genre",
            number: data.number,
          }),
        async (genres) => {
          metadataTranslation.value = await this.openAiTranslator.translateMetadata(
            { title: fields.title.source, plot: fields.plot.source, genres },
            target,
            config,
            signal,
          );
          return metadataTranslation.value?.genres ?? null;
        },
        signal,
      );

      let translationError: string | null = null;
      for (const field of ["title", "plot"] as const) {
        const prepared = fields[field];
        if (!prepared.source) continue;
        const returned = normalizeNewlines(metadataTranslation.value?.[field] ?? "").trim();
        if (returned && returned !== prepared.source) {
          prepared.translated = ensureTargetChinese(returned, target);
          continue;
        }
        const message = `Translation engine failed for ${field} (${data.number}), returning original text: ${returned ? "source echoed" : "engine returned no translation"}`;
        this.logger.warn(message);
        translationError = translationError ? `${translationError}; ${message}` : message;
      }

      throwIfAborted(signal);
      const title_zh = fields.title.translated;
      const plot_zh = fields.plot.translated;
      this.logger.info(
        `[translation] number=${data.number} durationMs=${Date.now() - startedAt} title=${title_zh ? "accepted" : "original"} plot=${!data.plot ? "absent" : plot_zh ? "accepted" : "original"} genresIn=${data.genres?.length ?? 0} genresOut=${mappedGenres.length} genresWithKana=${mappedGenres.filter((genre) => detectLanguage(genre) === "jp").length}`,
      );

      return {
        data: {
          ...data,
          title_zh,
          plot_zh,
          actors: mappedActors,
          actor_profiles: mappedActorProfiles.length > 0 ? mappedActorProfiles : data.actor_profiles,
          genres: mappedGenres,
        },
        error: translationError,
      };
    }).catch((error: unknown) => {
      if (isAbortError(error) || isUnrecoverableNetworkError(error)) throw error;
      const message = toErrorMessage(error);
      this.logger.warn(`Translation failed for ${data.number}: ${message}`);
      return { data, error: message };
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
      if (openAi) return ensureTargetChinese(openAi.trim(), target);
    }

    const field = context?.field ?? "text";
    const number = context?.number ?? "unknown";
    this.logger.warn(
      `Translation engine failed for ${field} (${number}), returning original text: engine returned no translation`,
    );
    return text;
  }
}
