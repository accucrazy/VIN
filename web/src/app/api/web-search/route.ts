/**
 * /api/web-search — pluggable web search (server-side).
 *
 * Auto-detects a search provider (Tavily/Brave/Serper → SearXNG → Browser/CDP →
 * DuckDuckGo Instant Answer) and returns ranked results. See src/lib/search and
 * .env.example for how to configure a backend. Runs on the server so the browser
 * never hits CORS and so a real Chrome (computer-use path) can be driven.
 */

import { NextRequest, NextResponse } from 'next/server';
import { runSearch } from '@/lib/search';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MAX_RESULTS = 5;
const HARD_MAX_RESULTS = 10;

export async function GET(req: NextRequest) {
  const query = (req.nextUrl.searchParams.get('q') ?? '').trim();
  const limit = Math.max(
    1,
    Math.min(HARD_MAX_RESULTS, Number(req.nextUrl.searchParams.get('n')) || DEFAULT_MAX_RESULTS),
  );

  if (!query) {
    return NextResponse.json({ error: 'missing query (?q=)' }, { status: 400 });
  }

  try {
    const { provider, results } = await runSearch(query, limit);
    return NextResponse.json({ query, provider, results });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, provider: 'error', results: [] },
      { status: 500 },
    );
  }
}
