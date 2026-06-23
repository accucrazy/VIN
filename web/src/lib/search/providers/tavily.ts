import type { SearchProvider, SearchResult } from '../types';

/** Tavily — AI-oriented search API. Free tier ~1000/mo. https://tavily.com */
export const tavilyProvider: SearchProvider = {
  name: 'tavily',
  label: 'Tavily',
  isAvailable: () => !!process.env.TAVILY_API_KEY,
  async search(query, limit): Promise<SearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: limit,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
    const data = await res.json();
    return (data?.results ?? []).slice(0, limit).map((r: any) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.content ?? '',
    }));
  },
};
