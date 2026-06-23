/**
 * web_fetch — demonstrates "security in the runtime, not the prompt".
 *
 * Two runtime boundaries, both enforced in code regardless of what the model "intends":
 *   1. validateUrlForSsrf() throws on private / loopback / cloud-metadata targets (with DNS pinning).
 *   2. wrapExternalContent() wraps the body in an untrusted-content boundary so injected
 *      instructions inside fetched pages are never treated as commands.
 */

import type { AgentTool } from '../types.js';
import { validateUrlForSsrf } from '../lib/net/ssrf.js';
import { wrapExternalContent } from '../security/external-content.js';

export const webFetchTool: AgentTool = {
  name: 'web_fetch',
  description: 'Fetch a URL. SSRF-guarded; the result is wrapped as untrusted content.',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'http(s) URL to fetch.' } },
    required: ['url'],
  },
  async execute(args) {
    try {
      await validateUrlForSsrf(args.url); // throws SsrfBlockedError on private/metadata targets
      const body = await fetch(args.url).then((r) => r.text());
      return { success: true, data: wrapExternalContent(body, { source: 'web_fetch' }) };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  },
};
