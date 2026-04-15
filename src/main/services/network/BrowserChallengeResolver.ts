import { createAbortError } from "@main/utils/abort";
import { BrowserWindow, type Cookie, type Event } from "electron";
import type { ResolvedCookie } from "./CookieResolver";
import { filterCookiesForUrl, normalizeCookieDomain, normalizeCookiePath } from "./cookieUtils";

export type BrowserHeaderProfile = Record<string, string>;

export interface BrowserChallengeRequest {
  url: string;
  expectedCookieNames?: string[];
  timeoutMs?: number;
  interactive?: boolean;
  partition?: string;
  userAgent?: string;
  signal?: AbortSignal;
}

export interface BrowserChallengeSession {
  cookies: ResolvedCookie[];
  headers: BrowserHeaderProfile;
}

export interface BrowserChallengeResolver {
  resolve(request: BrowserChallengeRequest): Promise<BrowserChallengeSession>;
}

export interface ElectronBrowserChallengeResolverOptions {
  timeoutMs?: number;
  getProxyUrl?: () => string | undefined;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const COOKIE_POLL_INTERVAL_MS = 250;
const REUSABLE_BROWSER_HEADER_NAMES = new Set([
  "accept-language",
  "sec-ch-ua",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-mobile",
  "sec-ch-ua-model",
  "sec-ch-ua-platform",
  "sec-ch-ua-platform-version",
  "user-agent",
]);

const toResolvedCookie = (cookie: Cookie): ResolvedCookie => ({
  name: cookie.name,
  value: cookie.value,
  domain: normalizeCookieDomain(cookie.domain ?? ""),
  path: normalizeCookiePath(cookie.path),
});

const defaultPartition = (url: string): string => {
  return `persist:mdcz-cloudflare-${new URL(url).hostname}`;
};

const closeWindow = (browserWindow: BrowserWindow): void => {
  if (!browserWindow.isDestroyed()) {
    browserWindow.destroy();
  }
};

const applyProxy = async (
  browserWindow: BrowserWindow,
  getProxyUrl: (() => string | undefined) | undefined,
): Promise<void> => {
  const proxyUrl = getProxyUrl?.();
  if (!proxyUrl) {
    return;
  }

  await browserWindow.webContents.session.setProxy({
    proxyRules: proxyUrl,
  });
};

const clearExpectedCookies = async (browserWindow: BrowserWindow, request: BrowserChallengeRequest): Promise<void> => {
  for (const name of request.expectedCookieNames ?? []) {
    await browserWindow.webContents.session.cookies.remove(request.url, name);
  }
};

const captureReusableHeaders = (headers: Record<string, string | string[] | undefined>): BrowserHeaderProfile => {
  const captured: BrowserHeaderProfile = {};

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase();
    if (!REUSABLE_BROWSER_HEADER_NAMES.has(normalizedKey)) {
      continue;
    }

    const normalizedValue = Array.isArray(value) ? value.join(", ") : value;
    if (normalizedValue?.trim()) {
      captured[normalizedKey] = normalizedValue;
    }
  }

  return captured;
};

const mergeHeaders = (target: BrowserHeaderProfile, source: BrowserHeaderProfile): void => {
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
};

const installHeaderCapture = (
  browserWindow: BrowserWindow,
  url: string,
  headers: BrowserHeaderProfile,
): (() => void) => {
  const origin = new URL(url).origin;
  const filter = { urls: [`${origin}/*`] };
  const webRequest = browserWindow.webContents.session.webRequest;

  webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    mergeHeaders(headers, captureReusableHeaders(details.requestHeaders));
    callback({ requestHeaders: details.requestHeaders });
  });

  return () => webRequest.onBeforeSendHeaders(filter, null);
};

const waitForChallengeSession = (
  browserWindow: BrowserWindow,
  request: Required<Pick<BrowserChallengeRequest, "timeoutMs">> &
    Pick<BrowserChallengeRequest, "expectedCookieNames" | "signal" | "url">,
  headers: BrowserHeaderProfile,
): Promise<BrowserChallengeSession> => {
  const targetUrl = new URL(request.url);
  const cookieLookupUrl = new URL(request.url);
  cookieLookupUrl.hash = "";
  const expectedCookieNames = new Set((request.expectedCookieNames ?? []).map((name) => name.trim()).filter(Boolean));

  return new Promise<BrowserChallengeSession>((resolve, reject) => {
    let settled = false;
    let pollInFlight = false;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      clearInterval(intervalHandle);
      request.signal?.removeEventListener("abort", handleAbort);
      browserWindow.webContents.removeListener("did-fail-load", handleLoadFailure);
      browserWindow.removeListener("closed", handleClosed);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };

    const pollCookies = async () => {
      if (pollInFlight || settled || browserWindow.isDestroyed()) {
        return;
      }
      pollInFlight = true;

      try {
        const cookies = await browserWindow.webContents.session.cookies.get({ url: cookieLookupUrl.toString() });
        const resolvedCookies = filterCookiesForUrl(cookies.map(toResolvedCookie), targetUrl);
        const hasExpectedCookie =
          expectedCookieNames.size > 0 && resolvedCookies.some((cookie) => expectedCookieNames.has(cookie.name));

        if (resolvedCookies.length > 0 && (expectedCookieNames.size === 0 || hasExpectedCookie)) {
          finish(() => resolve({ cookies: resolvedCookies, headers: { ...headers } }));
        }
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      } finally {
        pollInFlight = false;
      }
    };

    const handleLoadFailure = (
      _event: Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) {
        return;
      }
      finish(() =>
        reject(
          new Error(
            `Browser challenge failed for ${validatedUrl || request.url}: ${errorDescription || "unknown error"} (${errorCode})`,
          ),
        ),
      );
    };

    const handleClosed = () => {
      finish(() => reject(new Error(`Browser challenge window closed before resolving ${request.url}`)));
    };

    const handleAbort = () => {
      finish(() => {
        closeWindow(browserWindow);
        reject(createAbortError());
      });
    };

    const timeoutHandle = setTimeout(() => {
      const expectation =
        expectedCookieNames.size > 0 ? `expected cookies ${Array.from(expectedCookieNames).join(", ")}` : "cookies";
      finish(() => reject(new Error(`Timed out waiting for ${expectation} at ${request.url}`)));
    }, request.timeoutMs);

    const intervalHandle = setInterval(() => {
      void pollCookies();
    }, COOKIE_POLL_INTERVAL_MS);

    browserWindow.webContents.on("did-fail-load", handleLoadFailure);
    browserWindow.on("closed", handleClosed);

    if (request.signal?.aborted) {
      handleAbort();
      return;
    }

    request.signal?.addEventListener("abort", handleAbort, { once: true });

    void pollCookies();
  });
};

export const createElectronBrowserChallengeResolver = (
  options: ElectronBrowserChallengeResolverOptions = {},
): BrowserChallengeResolver => {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async resolve(request: BrowserChallengeRequest): Promise<BrowserChallengeSession> {
      const browserWindow = new BrowserWindow({
        show: request.interactive ?? false,
        width: 1100,
        height: 760,
        webPreferences: {
          partition: request.partition ?? defaultPartition(request.url),
          backgroundThrottling: false,
          contextIsolation: true,
          javascript: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const headers: BrowserHeaderProfile = {};
      const removeHeaderCapture = installHeaderCapture(browserWindow, request.url, headers);

      browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

      try {
        await applyProxy(browserWindow, options.getProxyUrl);
        await clearExpectedCookies(browserWindow, request);
        void browserWindow.webContents
          .loadURL(request.url, request.userAgent ? { userAgent: request.userAgent } : undefined)
          .catch(() => undefined);

        return await waitForChallengeSession(
          browserWindow,
          {
            url: request.url,
            timeoutMs: request.timeoutMs ?? defaultTimeoutMs,
            expectedCookieNames: request.expectedCookieNames,
            signal: request.signal,
          },
          headers,
        );
      } finally {
        removeHeaderCapture();
        closeWindow(browserWindow);
      }
    },
  };
};
