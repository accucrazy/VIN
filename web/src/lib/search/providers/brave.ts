import type { SearchProvider, SearchResult } from '../types';

/** Brave Search API. Free tier available. https://brave.com/search/api */
export const braveProvider: SearchProvider = {
  name: 'brave',
  label: 'Brave Search',
  isAvailable: () => !!process.env.BRAVE_API_KEY,
  async search(query, limit): Promise<SearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': process.env.BRAVE_API_KEY as string,
      },
    });
    if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
    const data = await res.json();
    return (data?.web?.results ?? []).slice(0, limit).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.description ?? '',
    }));
  },
};
