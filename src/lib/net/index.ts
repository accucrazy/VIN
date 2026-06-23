/**
 * Network utilities for SSRF protection and DNS handling
 */

export { normalizeHostname } from "./hostname.js";
export {
  isPrivateIpAddress,
  isPrivateIpv4,
  isPrivateIpv6,
  isValidIpAddress,
  isValidIpv4,
  isValidIpv6,
  isIpv6,
} from "./ip-utils.js";
export {
  SsrfBlockedError,
  isBlockedHostname,
  isBlockedHostnameOrIp,
  resolvePinnedHostnameWithPolicy,
  validateUrlForSsrf,
  type SsrfPolicy,
  type PinnedHostname,
} from "./ssrf.js";
export {
  fetchWithSsrfGuard,
  fetchWithRetry,
  type GuardedFetchOptions,
  type GuardedFetchResult,
  type RetryOptions,
} from "./fetch-guard.js";
