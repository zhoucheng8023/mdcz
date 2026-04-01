import { setTimeout as sleep } from "node:timers/promises";
import type { Configuration } from "@main/services/config";
import { toErrorMessage } from "@main/utils/common";
import { parseRetryAfterMs, readRetryAfterHeader } from "@main/utils/http";
import type OpenAI from "openai";
import PQueue from "p-queue";
import { isAbortError, throwIfAborted } from "../../abort";
import { getTargetLanguageLabel } from "../shared";
import type { LanguageTarget } from "../types";

interface TranslationLogger {
  warn(message: string): void;
}

const OPENAI_RETRY_STATUS_CODE = 429;
const RETRY_AFTER_CAP_MS = 15_000;
const QUOTE_PATTERN = /^['\u0022\u201C\u201D]+|['\u0022\u201C\u201D]+$/gu;

export class OpenAiTranslator {
  private readonly requestQueues = new Map<number, PQueue>();

  constructor(
    private readonly logger: TranslationLogger,
    private readonly openAiFactory: (config: Configuration) => OpenAI,
  ) {}

  async translateText(
    text: string,
    target: LanguageTarget,
    config: Configuration,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!config.translate.llmApiKey.trim()) {
      return null;
    }

    throwIfAborted(signal);

    const prompt = config.translate.llmPrompt
      .replaceAll("{lang}", getTargetLanguageLabel(target))
      .replaceAll("{content}", text);

    const response = await this.requestChatCompletion(
      config,
      {
        model: config.translate.llmModelName,
        temperature: config.translate.llmTemperature,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      signal,
    ).catch((error) => {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`OpenAI translation failed: ${toErrorMessage(error)}`);
      return null;
    });

    const content = response?.choices[0]?.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }

    return null;
  }

  async translateSingleLine(prompt: string, config: Configuration, signal?: AbortSignal): Promise<string | null> {
    if (!config.translate.llmApiKey.trim()) {
      return null;
    }

    throwIfAborted(signal);

    const response = await this.requestChatCompletion(
      config,
      {
        model: config.translate.llmModelName,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      },
      signal,
    ).catch((error) => {
      if (isAbortError(error)) {
        throw error;
      }
      this.logger.warn(`OpenAI term translation failed: ${toErrorMessage(error)}`);
      return null;
    });

    const content = response?.choices[0]?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      return null;
    }

    const firstLine = content
      .trim()
      .split(/\r?\n/gu)
      .find((line) => line.trim().length > 0);

    return firstLine ? firstLine.trim().replace(QUOTE_PATTERN, "") : null;
  }

  private requestChatCompletion(
    config: Configuration,
    payload: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    signal?: AbortSignal,
  ) {
    const client = this.openAiFactory(config);
    return this.executeRequestWithRetry(config, () => client.chat.completions.create(payload, { signal }), signal);
  }

  private getRequestsPerSecond(config: Configuration): number {
    const configured = Number(config.translate.llmMaxRequestsPerSecond);
    if (!Number.isFinite(configured)) {
      return 1;
    }

    return Math.max(1, Math.trunc(configured));
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
    const maxRetryCount = Math.max(0, Math.trunc(config.translate.llmMaxRetries));
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

        const retryAfterMs = this.getRetryAfterDelayMs(error);
        if (retryAfterMs === null) {
          throw error;
        }

        attempt += 1;
        this.logger.warn(`OpenAI returned 429, retrying (${attempt}/${maxRetryCount}) after ${retryAfterMs}ms`);
        await sleep(retryAfterMs, undefined, signal ? { signal } : undefined);
      }
    }
  }

  private getRetryAfterDelayMs(error: unknown): number | null {
    if (!error || typeof error !== "object") {
      return null;
    }

    const status = (error as { status?: unknown }).status;
    if (status !== OPENAI_RETRY_STATUS_CODE) {
      return null;
    }

    const headers =
      (error as { headers?: unknown }).headers ?? (error as { response?: { headers?: unknown } }).response?.headers;

    const rawRetryAfter = readRetryAfterHeader(headers);
    const parsed = parseRetryAfterMs(rawRetryAfter);
    if (parsed === null) {
      return null;
    }

    return Math.min(parsed, RETRY_AFTER_CAP_MS);
  }
}
