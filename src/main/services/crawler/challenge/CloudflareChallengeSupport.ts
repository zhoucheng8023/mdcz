import type { BrowserChallengeResolver, BrowserChallengeSession } from "@main/services/network";
import { throwIfAborted } from "@main/utils/abort";
import { toErrorMessage } from "@main/utils/common";
import type { CrawlerInput } from "../base/types";
import type { FetchOptions } from "../FetchGateway";

interface CloudflareChallengeSupportOptions {
  resolver?: BrowserChallengeResolver;
  challengeUrl?: (input: CrawlerInput) => string;
}

interface RetryInput<T> {
  input: CrawlerInput;
  operation: () => Promise<T>;
  challengeUrl?: string;
  onResolved?: () => void;
}

interface HtmlRetryInput {
  input: CrawlerInput;
  url: string;
  operation: () => Promise<string>;
  onResolved?: () => void;
}

const CLOUDFLARE_COOKIE_NAMES = ["cf_clearance"];
const CLOUDFLARE_CHALLENGE_PATTERN = /cloudflare challenge|cf_clearance|cf-chl|challenge-platform|forbidden|HTTP 403/iu;
const CLOUDFLARE_HTML_MARKER_PATTERN =
  /cf_clearance|cf-chl|challenge-platform|cdn-cgi\/challenge-platform|\bray[-\s]?id\b/iu;
const CLOUDFLARE_PAGE_TEXT_PATTERN =
  /cloudflare[\s\S]{0,400}(access denied|just a moment|checking your browser|verify you are human)|(access denied|just a moment|checking your browser|verify you are human)[\s\S]{0,400}cloudflare/iu;

const uniqueStrings = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
};

const buildCookieHeader = (cookies: BrowserChallengeSession["cookies"]): string | undefined => {
  const values = uniqueStrings(
    cookies.map((cookie) => {
      const name = cookie.name.trim();
      return name ? `${name}=${cookie.value}` : undefined;
    }),
  );
  return values.length > 0 ? values.join("; ") : undefined;
};

const mergeCookieHeaders = (...values: Array<string | undefined>): string | undefined => {
  const merged = uniqueStrings(
    values.flatMap((value) => {
      if (!value) {
        return [];
      }
      return value
        .split(";")
        .map((cookie) => cookie.trim())
        .filter(Boolean);
    }),
  );
  return merged.length > 0 ? merged.join("; ") : undefined;
};

const hasCloudflareClearance = (session: BrowserChallengeSession): boolean => {
  return session.cookies.some((cookie) => CLOUDFLARE_COOKIE_NAMES.includes(cookie.name));
};

export const isCloudflareChallengeError = (message: string): boolean => CLOUDFLARE_CHALLENGE_PATTERN.test(message);

export const isCloudflareChallengeHtml = (html: string): boolean => {
  return CLOUDFLARE_HTML_MARKER_PATTERN.test(html) || CLOUDFLARE_PAGE_TEXT_PATTERN.test(html);
};

export class CloudflareChallengeSupport {
  private session: BrowserChallengeSession | null = null;

  constructor(private readonly options: CloudflareChallengeSupportOptions) {}

  async withRetry<T>({ input, operation, challengeUrl, onResolved }: RetryInput<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const message = toErrorMessage(error);
      if (!(await this.resolve(input, message, challengeUrl))) {
        throw error;
      }

      onResolved?.();
      return operation();
    }
  }

  async withHtmlRetry({ input, url, operation, onResolved }: HtmlRetryInput): Promise<string> {
    const html = await this.withRetry({
      input,
      operation,
      challengeUrl: url,
      onResolved,
    });

    if (!isCloudflareChallengeHtml(html)) {
      return html;
    }

    if (!(await this.resolve(input, `Cloudflare challenge page returned for ${url}`, url))) {
      return html;
    }

    onResolved?.();
    const retriedHtml = await operation();
    if (isCloudflareChallengeHtml(retriedHtml)) {
      throw new Error(`Cloudflare challenge persisted after retry for ${url}`);
    }
    return retriedHtml;
  }

  createFetchOptions(options: FetchOptions): FetchOptions {
    const challengeCookieHeader = this.session ? buildCookieHeader(this.session.cookies) : undefined;
    const headers = {
      ...(this.session?.headers ?? {}),
      ...(options.headers ?? {}),
    };

    return {
      ...options,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      cookies: mergeCookieHeaders(options.cookies, challengeCookieHeader),
    };
  }

  private async resolve(input: CrawlerInput, errorMessage: string, challengeUrl?: string): Promise<boolean> {
    const challengeOptions = input.options?.cloudflareChallenge;
    if (!challengeOptions || !this.options.resolver || !isCloudflareChallengeError(errorMessage)) {
      return false;
    }

    throwIfAborted(input.options?.signal);

    const session = await this.options.resolver.resolve({
      url: challengeUrl ?? this.options.challengeUrl?.(input) ?? this.resolveFallbackChallengeUrl(input),
      expectedCookieNames: CLOUDFLARE_COOKIE_NAMES,
      timeoutMs: challengeOptions.timeoutMs,
      interactive: challengeOptions.interactiveFallback,
      userAgent: input.options?.userAgent,
      signal: input.options?.signal,
    });

    if (!hasCloudflareClearance(session)) {
      return false;
    }

    this.session = session;
    return true;
  }

  private resolveFallbackChallengeUrl(input: CrawlerInput): string {
    const customUrl = input.options?.customUrl?.trim();
    if (customUrl) {
      return customUrl;
    }

    throw new Error(`Cloudflare challenge URL is not configured for ${input.site}`);
  }
}
