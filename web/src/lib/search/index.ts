/**
 * Web-search registry: auto-detects which provider to use and falls through on
 * failure. Mirrors Hermes Agent's pluggable-backend model.
 *
 * Selection order:
 *   1. SEARCH_PROVIDER env (force a specific provider by name), else
 *   2. first available provider in PROVIDER_ORDER.
 * On a runtime error, the registry continues to the next *available* provider so
 * a flaky backend never hard-fails the tool.
 *
 * Priority rationale: keyed APIs (best quality) → SearXNG (self-host) →
 * Browser/CDP (no key, real web results) → DDG Instant Answer (last resort).
 */

import type { SearchProvider, SearchResponse, SearchResult } from './types';
import { tavilyProvider } from './providers/tavily';
import { braveProvider } from './providers/brave';
import { serperProvider } from './providers/serper';
import { searxngProvider } from './providers/searxng';
import { browserProvider } from './providers/browser';
import { ddgInstantProvider } from './providers/ddg-instant';

const PROVIDER_ORDER: SearchProvider[] = [
  tavilyProvider,
  braveProvider,
  serperProvider,
  searxngProvider,
  browserProvider,
  ddgInstantProvider,
];

const BY_NAME = new Map(PROVIDER_ORDER.map((p) => [p.name, p]));

export function listProviders(): { name: string; label: string }[] {
  return PROVIDER_ORDER.map((p) => ({ name: p.name, label: p.label }));
}

async function isUp(p: SearchProvider): Promise<boolean> {
  try {
    return await p.isAvailable();
  } catch {
    return false;
  }
}

export async function runSearch(query: string, limit: number): Promise<SearchResponse> {
  // Build the ordered candidate list.
  const forced = process.env.SEARCH_PROVIDER?.trim();
  let candidates: SearchProvider[];
  if (forced && BY_NAME.has(forced)) {
    // Forced provider first, then the rest as fallback.
    candidates = [BY_NAME.get(forced)!, ...PROVIDER_ORDER.filter((p) => p.name !== forced)];
  } else {
    candidates = PROVIDER_ORDER;
  }

  let lastError: string | null = null;
  for (const p of candidates) {
    if (!(await isUp(p))) continue;
    try {
      const results: SearchResult[] = await p.search(query, limit);
      // ddg-instant legitimately returns [] for many queries — only accept an
      // empty result from it if nothing better is configured. For real engines,
      // an empty list is a valid "no results" answer.
      if (results.length === 0 && p.name === 'ddg-instant') {
        return { provider: p.name, query, results };
      }
      return { provider: p.name, query, results };
    } catch (e) {
      lastError = `${p.name}: ${(e as Error).message}`;
      // fall through to the next available provider
    }
  }

  return {
    provider: lastError ? `error (${lastError})` : 'none',
    query,
    results: [],
  };
}
