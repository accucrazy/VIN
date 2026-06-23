/**
 * web_search — keyword web search via the DuckDuckGo Instant Answer API (no API key required).
 *
 * Difference from web_fetch:
 *   - web_fetch  takes a URL you already have and returns that page.
 *   - web_search takes a query string and returns a list of {title, url, snippet}.
 *
 * Source: https://api.duckduckgo.com/?q=...&format=json
 *   This is DuckDuckGo's *official* JSON endpoint (no key, not rate-blocked like the HTML scrape).
 *   IMPORTANT LIMITATION: it returns Instant Answers — an Abstract for the matched entity plus
 *   RelatedTopics — NOT a full ranked list of arbitrary web pages. It shines on entity/topic
 *   queries ("Taipei 101", "Python programming") and may return nothing for long natural-language
 *   questions. For full web ranking, swap in a keyed provider (Tavily/Serper/Brave) behind the
 *   same AgentTool interface.
 *
 * Security posture (same discipline as web_fetch):
 *   1. Only the fixed DuckDuckGo endpoint is contacted; the user query is URL-encoded into the
 *      querystring, so the model cannot point this tool at an arbitrary/internal host.
 *   2. Titles + snippets are external/untrusted text → wrapped via wrapExternalContent so injected
 *      instructions inside results are never treated as commands.
 */

import type { AgentTool } from '../types.js';
import { wrapExternalContent } from '../security/external-content.js';

const DDG_API_ENDPOINT = 'https://api.duckduckgo.com/';
const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 10;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** A RelatedTopic is either a leaf {Text, FirstURL} or a group {Name, Topics:[...]}. */
interface DdgRelatedTopic {
  Text?: string;
  FirstURL?: string;
  Topics?: DdgRelatedTopic[];
}

interface DdgResponse {
  Heading?: string;
  AbstractText?: string;
  AbstractURL?: string;
  Results?: DdgRelatedTopic[];
  RelatedTopics?: DdgRelatedTopic[];
}

/** Flatten DDG RelatedTopics/Results (which can nest one level under Topics) into leaf results. */
function flattenTopics(topics: DdgRelatedTopic[] | undefined, out: SearchResult[], limit: number): void {
  if (!topics) return;
  for (const t of topics) {
    if (out.length >= limit) return;
    if (t.Topics && t.Topics.length > 0) {
      flattenTopics(t.Topics, out, limit);
      continue;
    }
    if (t.Text && t.FirstURL) {
      // DDG "Text" is "Title — description"; take the leading clause as the title.
      const dashIdx = t.Text.indexOf(' - ');
      const title = dashIdx > 0 ? t.Text.slice(0, dashIdx) : t.Text;
      out.push({ title: title.trim(), url: t.FirstURL, snippet: t.Text.trim() });
    }
  }
}

function buildResults(data: DdgResponse, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  // 1. The primary Abstract (the entity's main answer), if present.
  if (data.AbstractText && data.AbstractURL) {
    results.push({
      title: data.Heading || 'Summary',
      url: data.AbstractURL,
      snippet: data.AbstractText,
    });
  }

  // 2. Direct Results (rare), then RelatedTopics.
  flattenTopics(data.Results, results, limit);
  flattenTopics(data.RelatedTopics, results, limit);

  return results.slice(0, limit);
}

function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return (
      `No instant-answer results for "${query}".\n` +
      `(web_search uses DuckDuckGo's Instant Answer API, which covers entities/topics rather than ` +
      `arbitrary pages. Try a more entity-like query, or use web_fetch on a known URL.)`
    );
  }
  const lines = results.map(
    (r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`,
  );
  return `Web search results for "${query}":\n\n${lines.join('\n\n')}`;
}

export const webSearchTool: AgentTool = {
  name: 'web_search',
  description:
    'Search the web for a query and return a list of {title, url, snippet} via DuckDuckGo. ' +
    'Best for entities/topics. Use web_fetch to read a specific URL. Results are untrusted content.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      maxResults: {
        type: 'number',
        description: `How many results to return (1-${HARD_MAX_RESULTS}, default ${DEFAULT_MAX_RESULTS}).`,
      },
    },
    required: ['query'],
  },
  async execute(args) {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query) {
      return { success: false, error: 'web_search requires a non-empty "query".' };
    }
    const limit = Math.max(
      1,
      Math.min(HARD_MAX_RESULTS, Number(args.maxResults) || DEFAULT_MAX_RESULTS),
    );

    const url =
      `${DDG_API_ENDPOINT}?q=${encodeURIComponent(query)}` +
      `&format=json&no_html=1&no_redirect=1&skip_disambig=1&t=vin`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VIN/0.1 (+https://github.com/accucrazy/VIN)' },
      });
      if (!res.ok) {
        return { success: false, error: `web_search upstream error: HTTP ${res.status}` };
      }

      const data = (await res.json()) as DdgResponse;
      const results = buildResults(data, limit);
      const formatted = formatResults(query, results);

      return {
        success: true,
        data: wrapExternalContent(formatted, { source: 'web_search', sourceLabel: query }),
      };
    } catch (err) {
      return { success: false, error: `web_search failed: ${(err as Error).message}` };
    }
  },
};
