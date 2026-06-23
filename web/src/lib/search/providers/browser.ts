import fs from 'fs';
import type { Browser } from 'puppeteer-core';
import puppeteer from 'puppeteer-core';
import type { SearchProvider, SearchResult } from '../types';

/**
 * Browser provider — OpenClaw-style "computer use": drives a REAL Chrome via
 * the DevTools Protocol (puppeteer-core) and scrapes a search-engine results
 * page. No API key. A real browser (JS enabled, real UA) gets past the
 * anti-bot challenge pages that block plain `curl`/fetch scraping.
 *
 * Uses the system Chrome (no bundled Chromium) — set CHROME_PATH to override.
 */

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean) as string[];

function findChrome(): string | null {
  for (const p of CHROME_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// Reuse one browser across requests (and survive Next.js dev hot-reloads).
const g = globalThis as unknown as { __vinSearchBrowser?: Browser };

async function getBrowser(execPath: string): Promise<Browser> {
  if (g.__vinSearchBrowser && g.__vinSearchBrowser.connected) {
    return g.__vinSearchBrowser;
  }
  const browser = await puppeteer.launch({
    executablePath: execPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US',
    ],
  });
  g.__vinSearchBrowser = browser;
  return browser;
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Unwrap DuckDuckGo's HTML redirect link back to the real URL:
 *   //duckduckgo.com/l/?uddg=<encoded-real-url>&rut=...
 */
function unwrapDdgUrl(href: string): string {
  try {
    if (!href) return href;
    const u = new URL(href, 'https://duckduckgo.com');
    if (u.pathname.startsWith('/l/')) {
      const real = u.searchParams.get('uddg');
      if (real) return decodeURIComponent(real);
    }
    return href.startsWith('//') ? `https:${href}` : href;
  } catch {
    return href;
  }
}

export const browserProvider: SearchProvider = {
  name: 'browser',
  label: 'Browser (Chrome/CDP)',
  isAvailable: () => findChrome() !== null,
  async search(query, limit): Promise<SearchResult[]> {
    const execPath = findChrome();
    if (!execPath) throw new Error('No Chrome/Chromium found (set CHROME_PATH)');

    const browser = await getBrowser(execPath);
    const page = await browser.newPage();
    try {
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' });
      await page.setViewport({ width: 1280, height: 900 });

      // DuckDuckGo's HTML endpoint blocks plain curl/fetch (anomaly challenge)
      // but a REAL browser passes it and returns clean, localized results — with
      // useful snippets (e.g. live stock prices) intact, for CJK queries too.
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForSelector('.result__a, .no-results', { timeout: 8000 }).catch(() => {});

      const raw: { title: string; url: string; snippet: string }[] = await page.evaluate(() => {
        const out: { title: string; url: string; snippet: string }[] = [];
        const nodes = document.querySelectorAll('div.result, div.web-result');
        nodes.forEach((node) => {
          if (node.classList.contains('result--ad')) return;
          const a = node.querySelector('a.result__a') as HTMLAnchorElement | null;
          if (!a) return;
          const href = a.getAttribute('href') || '';
          const snipEl = node.querySelector('.result__snippet');
          out.push({
            title: (a.textContent || '').trim(),
            url: href,
            snippet: (snipEl?.textContent || '').replace(/\s+/g, ' ').trim(),
          });
        });
        return out;
      });

      // Unwrap DDG redirect links + dedupe by final URL.
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      for (const r of raw) {
        const real = unwrapDdgUrl(r.url);
        if (!real || seen.has(real)) continue;
        seen.add(real);
        results.push({ title: r.title, url: real, snippet: r.snippet });
        if (results.length >= limit) break;
      }
      return results;
    } finally {
      await page.close().catch(() => {});
    }
  },
};
