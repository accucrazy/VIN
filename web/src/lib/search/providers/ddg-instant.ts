import type { SearchProvider, SearchResult } from '../types';

/**
 * DuckDuckGo Instant Answer JSON API — no key, but LIMITED: returns entity
 * abstracts + related topics, NOT a ranked web result list. Good for "what is X"
 * entity lookups, useless for real-time facts (stock prices, news). Last-resort
 * fallback so the tool never hard-fails.
 */
const ENDPOINT = 'https://api.duckduckgo.com/';

interface Topic {
  Text?: string;
  FirstURL?: string;
  Topics?: Topic[];
}

function flatten(topics: Topic[] | undefined, out: SearchResult[], limit: number): void {
  if (!topics) return;
  for (const t of topics) {
    if (out.length >= limit) return;
    if (t.Topics?.length) {
      flatten(t.Topics, out, limit);
      continue;
    }
    if (t.Text && t.FirstURL) {
      const dash = t.Text.indexOf(' - ');
      out.push({
        title: (dash > 0 ? t.Text.slice(0, dash) : t.Text).trim(),
        url: t.FirstURL,
        snippet: t.Text.trim(),
      });
    }
  }
}

export const ddgInstantProvider: SearchProvider = {
  name: 'ddg-instant',
  label: 'DuckDuckGo Instant Answer',
  isAvailable: () => true,
  async search(query, limit): Promise<SearchResult[]> {
    const url =
      `${ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&format=json&no_html=1&no_redirect=1&skip_disambig=1&t=vin`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VIN/0.1 (+https://github.com/accucrazy/VIN)' },
    });
    if (!res.ok) throw new Error(`DDG HTTP ${res.status}`);
    const data = await res.json();
    const results: SearchResult[] = [];
    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: data.Heading || 'Summary',
        url: data.AbstractURL,
        snippet: data.AbstractText,
      });
    }
    flatten(data.Results, results, limit);
    flatten(data.RelatedTopics, results, limit);
    return results.slice(0, limit);
  },
};
