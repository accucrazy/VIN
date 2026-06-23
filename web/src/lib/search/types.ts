/**
 * Pluggable web-search provider contract.
 *
 * Design mirrors NousResearch's Hermes Agent: every backend implements a tiny
 * interface, declares whether it `isAvailable()` (key/URL present), and the
 * registry auto-detects which one to use. Open-source users pick a provider by
 * setting the matching env var — no code changes required.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  provider: string;
  query: string;
  results: SearchResult[];
}

export interface SearchProvider {
  /** Stable id, also shown in the UI tool card (e.g. "tavily", "browser"). */
  name: string;
  /** Human label for logs / UI. */
  label: string;
  /** True when this provider has the config it needs (key/URL/binary). */
  isAvailable(): boolean | Promise<boolean>;
  /** Run a search. Throw to let the registry fall through to the next provider. */
  search(query: string, limit: number): Promise<SearchResult[]>;
}
