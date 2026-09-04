import { setTimeout as sleep } from "node:timers/promises";
import type { Configuration } from "@mdcz/shared/config";
import PQueue from "p-queue";
import { isUnrecoverableNetworkError } from "../../../network";
import { parseRetryAfterMs, readRetryAfterHeader, toErrorMessage } from "../../../shared";
import { isAbortError, throwIfAborted } from "../../utils/abort";
import { getTargetLanguageLabel } from "../shared";
import type { LanguageTarget } from "../types";
import { isMissingRequiredLlmApiKey, type LlmApiClient, LlmTransportError } from "./LlmApiClient";

interface TranslationLogger {
  warn(message: string): void;
}

const OPENAI_RETRY_STATUS_CODE = 429;
const RETRY_AFTER_CAP_MS = 15_000;
const REQUEST_TIMEOUT_PATTERN =
  /request timeout|timed ?out|timeout \(\d+ ms\)|error reading response stream|kind: *body|econnreset|etimedout/iu;
const COMPLETE_LEADING_THINK_PATTERN = /^<think>[\s\S]*?<\/think>\s*/iu;
const TRANSLATION_ONLY_INSTRUCTION = "只输出最终译文，不要输出思考过程、解释、提示词或原文。";

const buildTranslationPrompt = (prompt: string): string => `${prompt.trim()}

${TRANSLATION_ONLY_INSTRUCTION}`;

export const cleanTranslationOutput = (output: string | null, prompt: string, source: string): string | null => {
  if (typeof output !== "string") {
    return null;
  }

  const translated = output.replace(COMPLETE_LEADING_THINK_PATTERN, "").trim();
  const normalizedPrompt = prompt.trim();
  const normalizedSource = source.trim();
  if (
    !translated ||
    translated === normalizedPrompt ||
    translated === normalizedSource ||
    translated === buildTranslationPrompt(prompt)
  ) {
    return null;
  }

  return translated;
};

interface RetryDecision {
  delayMs: number;
  reason: string;
}

export interface LlmMetadataTranslationInput {
  title: string | null;
  plot: string | null;
  genres: string[];
}

export interface LlmMetadataTranslationResult {
  title: string | null;
  plot: string | null;
  genres: string[];
}

export class OpenAiTranslator {
  private readonly requestQueues = new Map<number, PQueue>();

  constructor(
    private readonly logger: TranslationLogger,
    private readonly llmApiClient: LlmApiClient,
  ) {}

  async translateText(
    text: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (
      !config.translate.llmModelName.trim() ||
      isMissingRequiredLlmApiKey(config.translate.llmBaseUrl, config.translate.llmApiKey)
    ) {
      return null;
    }

    throwIfAborted(signal);

    const prompt = config.translate.llmPrompt
      .replaceAll("{lang}", getTargetLanguageLabel(target))
      .replaceAll("{content}", text);
    const contractedPrompt = buildTranslationPrompt(prompt);

    const content = await this.requestText(config, contractedPrompt, config.translate.llmTemperature, signal).catch(
      (error) => {
        if (isAbortError(error) || isUnrecoverableNetworkError(error)) {
          throw error;
        }
        this.logger.warn(`LLM translation failed: ${toErrorMessage(error)}`);
        return null;
      },
    );

    return cleanTranslationOutput(content, prompt, text);
  }

  async translateMetadata(
    input: LlmMetadataTranslationInput,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<LlmMetadataTranslationResult | null> {
    if (!input.title && !input.plot && input.genres.length === 0) {
      return { title: null, plot: null, genres: [] };
    }
    if (
      !config.translate.llmModelName.trim() ||
      isMissingRequiredLlmApiKey(config.translate.llmBaseUrl, config.translate.llmApiKey)
    ) {
      return null;
    }

    throwIfAborted(signal);

    const prompt = [
      `将输入 JSON 中的影片元数据翻译为${getTargetLanguageLabel(target)}。`,
      "返回值必须符合指定的 JSON Schema。",
      "title 和 plot 为 null 时保持 null，否则只返回最终译文。",
      `genres 必须返回 ${input.genres.length} 项，顺序与输入完全一致，每项只包含一个简短标签。`,
      "不要返回解释、Markdown、提示词或原文之外的额外字段。",
      "输入 JSON：",
      JSON.stringify(input),
    ].join("\n");
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: input.title === null ? "null" : "string" },
        plot: { type: input.plot === null ? "null" : "string" },
        genres: {
          type: "array",
          minItems: input.genres.length,
          maxItems: input.genres.length,
          items: { type: "string" },
        },
      },
      required: ["title", "plot", "genres"],
    } satisfies Record<string, unknown>;

    const content = await this.requestText(config, prompt, config.translate.llmTemperature, signal, {
      name: "translated_metadata",
      schema,
    }).catch((error) => {
      if (isAbortError(error) || isUnrecoverableNetworkError(error)) {
        throw error;
      }
      this.logger.warn(`LLM metadata translation failed: ${toErrorMessage(error)}`);
      return null;
    });
    if (!content) return null;
    const invalidResponse = () => {
      this.logger.warn("LLM metadata translation returned invalid structured output");
      return null;
    };

    try {
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return invalidResponse();
      const candidate = parsed as Record<string, unknown>;
      if (input.title === null ? candidate.title !== null : typeof candidate.title !== "string")
        return invalidResponse();
      if (input.plot === null ? candidate.plot !== null : typeof candidate.plot !== "string") return invalidResponse();
      if (!Array.isArray(candidate.genres) || candidate.genres.length !== input.genres.length) return invalidResponse();

      const genres: string[] = [];
      for (const value of candidate.genres) {
        if (typeof value !== "string") return invalidResponse();
        const normalized = value.trim();
        if (!normalized) return invalidResponse();
        genres.push(normalized);
      }

      const title = typeof candidate.title === "string" ? candidate.title.trim() : null;
      const plot = typeof candidate.plot === "string" ? candidate.plot.trim() : null;
      if ((input.title !== null && !title) || (input.plot !== null && !plot)) return invalidResponse();
      return { title, plot, genres };
    } catch {
      return invalidResponse();
    }
  }

  private requestText(
    config: Configuration,
    prompt: string,
    temperature: number,
    signal?: AbortSignal,
    responseFormat?: { name: string; schema: Record<string, unknown> },
  ) {
    return this.executeRequestWithRetry(
      config,
      () =>
        this.llmApiClient.generateText(
          {
            model: config.translate.llmModelName,
            apiKey: config.translate.llmApiKey,
            baseUrl: config.translate.llmBaseUrl,
            temperature,
            prompt,
            reasoningEffort: config.translate.llmReasoningEffort,
            responseFormat,
            timeout: this.getTimeoutMs(config),
          },
          signal,
        ),
      signal,
    );
  }

  private getRequestsPerSecond(config: Configuration): number {
    return config.translate.llmMaxRequestsPerSecond;
  }

  private getTimeoutMs(config: Configuration): number {
    return config.translate.llmTimeout * 1000;
  }

  private getQueue(config: Configuration): PQueue {
    const requestsPerSecond = this.getRequestsPerSecond(config);
    const existing = this.requestQueues.get(requestsPerSecond);
    if (existing) {
      return existing;
    }

    const queue = new PQueue({
      concurrency: 1,
      interval: 1000,
      intervalCap: requestsPerSecond,
    });
    this.requestQueues.set(requestsPerSecond, queue);
    return queue;
  }

  private async executeRequestWithRetry<T>(
    config: Configuration,
    request: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const maxRetryCount = config.translate.llmMaxRetries;
    let attempt = 0;

    while (true) {
      try {
        const queue = this.getQueue(config);
        return await queue.add(
          async () => {
            throwIfAborted(signal);
            return request();
          },
          signal ? { signal } : undefined,
        );
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        if (attempt >= maxRetryCount) {
          throw error;
        }

        const retryDecision = this.getRetryDecision(error, attempt);
        if (!retryDecision) {
          throw error;
        }

        attempt += 1;
        this.logger.warn(
          `LLM request retrying after ${retryDecision.reason} (${attempt}/${maxRetryCount}) in ${retryDecision.delayMs}ms`,
        );
        await sleep(retryDecision.delayMs, undefined, signal ? { signal } : undefined);
      }
    }
  }

  private getRetryDecision(error: unknown, attempt: number): RetryDecision | null {
    if (error instanceof LlmTransportError) {
      return { delayMs: this.getExponentialDelayMs(attempt), reason: "transport error" };
    }

    if (!error || typeof error !== "object") {
      return null;
    }

    const status = (error as { status?: unknown }).status;
    if (status !== OPENAI_RETRY_STATUS_CODE) {
      if (this.isRetryableTimeout(error)) {
        return { delayMs: this.getExponentialDelayMs(attempt), reason: "timeout" };
      }
      return null;
    }

    const headers =
      (error as { headers?: unknown }).headers ?? (error as { response?: { headers?: unknown } }).response?.headers;

    const rawRetryAfter = readRetryAfterHeader(headers);
    const parsed = parseRetryAfterMs(rawRetryAfter);
    if (parsed !== null) {
      return { delayMs: Math.min(parsed, RETRY_AFTER_CAP_MS), reason: "HTTP 429" };
    }

    return { delayMs: this.getExponentialDelayMs(attempt), reason: "HTTP 429" };
  }

  private getExponentialDelayMs(attempt: number): number {
    return Math.min(1000 * 2 ** attempt, RETRY_AFTER_CAP_MS);
  }

  private isRetryableTimeout(error: unknown): boolean {
    const message = toErrorMessage(error);
    return REQUEST_TIMEOUT_PATTERN.test(message);
  }
}
