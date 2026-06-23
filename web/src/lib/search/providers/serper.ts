import type { SearchProvider, SearchResult } from '../types';

/** Serper.dev — Google SERP API. https://serper.dev */
export const serperProvider: SearchProvider = {
  name: 'serper',
  label: 'Serper (Google)',
  isAvailable: () => !!process.env.SERPER_API_KEY,
  async search(query, limit): Promise<SearchResult[]> {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: limit }),
    });
    if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
    const data = await res.json();
    return (data?.organic ?? []).slice(0, limit).map((r: any) => ({
      title: r.title ?? '',
      url: r.link ?? '',
      snippet: r.snippet ?? '',
    }));
  },
};
