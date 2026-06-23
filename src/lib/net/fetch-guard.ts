/**
 * Secure fetch with SSRF protection
 */

import {
  SsrfBlockedError,
  resolvePinnedHostnameWithPolicy,
  type SsrfPolicy,
} from "./ssrf.js";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export type GuardedFetchOptions = {
  url: string;
  fetchImpl?: FetchLike;
  init?: RequestInit;
  maxRedirects?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  policy?: SsrfPolicy;
  auditContext?: string;
};

export type GuardedFetchResult = {
  response: Response;
  finalUrl: string;
};

const DEFAULT_MAX_REDIRECTS = 3;
const CROSS_ORIGIN_REDIRECT_SENSITIVE_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "cookie2",
];

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function stripSensitiveHeadersForCrossOriginRedirect(
  init?: RequestInit
): RequestInit | undefined {
  if (!init?.headers) {
    return init;
  }
  const headers = new Headers(init.headers);
  for (const header of CROSS_ORIGIN_REDIRECT_SENSITIVE_HEADERS) {
    headers.delete(header);
  }
  return { ...init, headers };
}

function buildAbortSignal(params: {
  timeoutMs?: number;
  signal?: AbortSignal;
}): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  const { timeoutMs, signal } = params;
  if (!timeoutMs && !signal) {
    return { signal: undefined, cleanup: () => {} };
  }

  if (!timeoutMs) {
    return { signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  const cleanup = () => {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  };

  return { signal: controller.signal, cleanup };
}

export async function fetchWithSsrfGuard(
  params: GuardedFetchOptions
): Promise<GuardedFetchResult> {
  const fetcher: FetchLike | undefined = params.fetchImpl ?? globalThis.fetch;
  if (!fetcher) {
    throw new Error("fetch is not available");
  }

  const maxRedirects =
    typeof params.maxRedirects === "number" &&
    Number.isFinite(params.maxRedirects)
      ? Math.max(0, Math.floor(params.maxRedirects))
      : DEFAULT_MAX_REDIRECTS;

  const { signal, cleanup } = buildAbortSignal({
    timeoutMs: params.timeoutMs,
    signal: params.signal,
  });

  const visited = new Set<string>();
  let currentUrl = params.url;
  let currentInit = params.init ? { ...params.init } : undefined;
  let redirectCount = 0;

  try {
    while (true) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        throw new Error("Invalid URL: must be http or https");
      }

      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid URL: must be http or https");
      }

      await resolvePinnedHostnameWithPolicy(parsedUrl.hostname, {
        policy: params.policy,
      });

      const init: RequestInit = {
        ...(currentInit ? { ...currentInit } : {}),
        redirect: "manual",
        ...(signal ? { signal } : {}),
      };

      const response = await fetcher(parsedUrl.toString(), init);

      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(
            `Redirect missing location header (${response.status})`
          );
        }

        redirectCount += 1;
        if (redirectCount > maxRedirects) {
          throw new Error(`Too many redirects (limit: ${maxRedirects})`);
        }

        const nextParsedUrl = new URL(location, parsedUrl);
        const nextUrl = nextParsedUrl.toString();

        if (visited.has(nextUrl)) {
          throw new Error("Redirect loop detected");
        }

        if (nextParsedUrl.origin !== parsedUrl.origin) {
          currentInit = stripSensitiveHeadersForCrossOriginRedirect(currentInit);
        }

        visited.add(nextUrl);
        void response.body?.cancel();
        currentUrl = nextUrl;
        continue;
      }

      return {
        response,
        finalUrl: currentUrl,
      };
    }
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      console.warn(
        `[Security] Blocked URL fetch: ${params.auditContext ?? "url-fetch"} - ${(err as Error).message}`
      );
    }
    throw err;
  } finally {
    cleanup();
  }
}

export type RetryOptions = {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

const DEFAULT_RETRY_OPTIONS: Required<Omit<RetryOptions, "shouldRetry">> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

function defaultShouldRetry(error: unknown, _attempt: number): boolean {
  if (error instanceof SsrfBlockedError) {
    return false;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("econnreset") ||
      message.includes("etimedout") ||
      message.includes("enotfound")
    ) {
      return true;
    }
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.2 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

export async function fetchWithRetry(
  params: GuardedFetchOptions,
  retryOptions?: RetryOptions
): Promise<GuardedFetchResult> {
  const options = {
    ...DEFAULT_RETRY_OPTIONS,
    ...retryOptions,
  };
  const shouldRetry = retryOptions?.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fetchWithSsrfGuard(params);
    } catch (error) {
      lastError = error;

      if (attempt >= options.maxRetries) {
        break;
      }

      if (!shouldRetry(error, attempt)) {
        break;
      }

      const delay = calculateDelay(
        attempt,
        options.baseDelayMs,
        options.maxDelayMs
      );
      console.log(
        `[Fetch] Retry attempt ${attempt + 1}/${options.maxRetries} after ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
