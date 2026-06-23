import type { SearchProvider, SearchResult } from '../types';

/**
 * SearXNG — self-hosted, privacy-respecting metasearch. No API key.
 * Point at a running instance via SEARXNG_URL (e.g. http://localhost:8080).
 * The instance must allow the JSON format (`search.formats: [json]` in settings.yml).
 */
export const searxngProvider: SearchProvider = {
  name: 'searxng',
  label: 'SearXNG',
  isAvailable: () => !!process.env.SEARXNG_URL,
  async search(query, limit): Promise<SearchResult[]> {
    const base = (process.env.SEARXNG_URL as string).replace(/\/+$/, '');
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
    const data = await res.json();
    return (data?.results ?? []).slice(0, limit).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
    }));
  },
};
