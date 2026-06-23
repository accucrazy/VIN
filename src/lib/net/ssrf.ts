/**
 * SSRF (Server-Side Request Forgery) protection
 */

import { lookup as dnsLookup } from "dns/promises";
import type { LookupAddress } from "dns";
import { normalizeHostname } from "./hostname.js";
import { isPrivateIpAddress } from "./ip-utils.js";

export class SsrfBlockedError extends Error {
  constructor(
    message: string,
    public readonly reason: string = "ssrf_blocked"
  ) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

export type SsrfPolicy = {
  allowPrivateNetwork?: boolean;
  allowedHostnames?: string[];
  hostnameAllowlist?: string[];
};

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "169.254.169.254",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
];

function normalizeHostnameSet(values?: string[]): Set<string> {
  if (!values || values.length === 0) {
    return new Set<string>();
  }
  return new Set(
    values
      .map((value) => normalizeHostname(value))
      .filter((v) => v.length > 0)
  );
}

function normalizeHostnameAllowlist(values?: string[]): string[] {
  if (!values || values.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      values
        .map((value) => normalizeHostname(value))
        .filter((value) => value !== "*" && value !== "*." && value.length > 0)
    )
  );
}

function isHostnameAllowedByPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    if (!suffix || hostname === suffix) {
      return false;
    }
    return hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

function matchesHostnameAllowlist(hostname: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) {
    return true;
  }
  return allowlist.some((pattern) => isHostnameAllowedByPattern(hostname, pattern));
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }

  for (const suffix of BLOCKED_HOSTNAME_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

export function isBlockedHostnameOrIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    return false;
  }

  if (isBlockedHostname(normalized)) {
    return true;
  }

  if (isPrivateIpAddress(normalized)) {
    return true;
  }

  return false;
}

function assertAllowedHostOrIpOrThrow(hostnameOrIp: string): void {
  if (isBlockedHostnameOrIp(hostnameOrIp)) {
    throw new SsrfBlockedError(
      "Blocked hostname or private/internal IP address",
      "blocked_host_or_ip"
    );
  }
}

function assertAllowedResolvedAddressesOrThrow(results: readonly LookupAddress[]): void {
  for (const entry of results) {
    if (isPrivateIpAddress(entry.address)) {
      throw new SsrfBlockedError(
        "Blocked: resolves to private/internal IP address",
        "blocked_resolved_ip"
      );
    }
  }
}

export type PinnedHostname = {
  hostname: string;
  addresses: string[];
};

export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { policy?: SsrfPolicy } = {}
): Promise<PinnedHostname> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Invalid hostname");
  }

  const allowPrivateNetwork = Boolean(params.policy?.allowPrivateNetwork);
  const allowedHostnames = normalizeHostnameSet(params.policy?.allowedHostnames);
  const hostnameAllowlist = normalizeHostnameAllowlist(params.policy?.hostnameAllowlist);
  const isExplicitAllowed = allowedHostnames.has(normalized);
  const skipPrivateNetworkChecks = allowPrivateNetwork || isExplicitAllowed;

  if (!matchesHostnameAllowlist(normalized, hostnameAllowlist)) {
    throw new SsrfBlockedError(
      `Blocked hostname (not in allowlist): ${hostname}`,
      "not_in_allowlist"
    );
  }

  if (!skipPrivateNetworkChecks) {
    assertAllowedHostOrIpOrThrow(normalized);
  }

  const results = await dnsLookup(normalized, { all: true });
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }

  if (!skipPrivateNetworkChecks) {
    assertAllowedResolvedAddressesOrThrow(results);
  }

  const addresses = Array.from(new Set(results.map((entry) => entry.address)));
  if (addresses.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }

  return {
    hostname: normalized,
    addresses,
  };
}

export async function validateUrlForSsrf(
  url: string,
  policy?: SsrfPolicy
): Promise<{ hostname: string; addresses: string[] }> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SsrfBlockedError("Invalid URL", "invalid_url");
  }

  const protocol = parsedUrl.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new SsrfBlockedError(
      "Only HTTP and HTTPS protocols are allowed",
      "invalid_protocol"
    );
  }

  const hostname = parsedUrl.hostname;
  return await resolvePinnedHostnameWithPolicy(hostname, { policy });
}
