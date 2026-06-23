/**
 * IP address utilities for SSRF protection
 */

const PRIVATE_IPV4_RANGES = [
  { start: [10, 0, 0, 0], end: [10, 255, 255, 255] },           // 10.0.0.0/8
  { start: [172, 16, 0, 0], end: [172, 31, 255, 255] },         // 172.16.0.0/12
  { start: [192, 168, 0, 0], end: [192, 168, 255, 255] },       // 192.168.0.0/16
  { start: [127, 0, 0, 0], end: [127, 255, 255, 255] },         // 127.0.0.0/8 (loopback)
  { start: [169, 254, 0, 0], end: [169, 254, 255, 255] },       // 169.254.0.0/16 (link-local)
  { start: [100, 64, 0, 0], end: [100, 127, 255, 255] },        // 100.64.0.0/10 (carrier-grade NAT)
  { start: [0, 0, 0, 0], end: [0, 255, 255, 255] },             // 0.0.0.0/8 (current network)
  { start: [224, 0, 0, 0], end: [239, 255, 255, 255] },         // 224.0.0.0/4 (multicast)
  { start: [240, 0, 0, 0], end: [255, 255, 255, 255] },         // 240.0.0.0/4 (reserved)
  { start: [198, 18, 0, 0], end: [198, 19, 255, 255] },         // 198.18.0.0/15 (benchmark testing)
];

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255 || part !== String(num)) {
      return null;
    }
    octets.push(num);
  }
  return octets;
}

function isInRange(ip: number[], range: { start: number[]; end: number[] }): boolean {
  for (let i = 0; i < 4; i++) {
    if (ip[i] < range.start[i] || ip[i] > range.end[i]) {
      return false;
    }
    if (ip[i] > range.start[i] && ip[i] < range.end[i]) {
      return true;
    }
  }
  return true;
}

export function isPrivateIpv4(ip: string): boolean {
  const parsed = parseIpv4(ip);
  if (!parsed) return false;

  return PRIVATE_IPV4_RANGES.some(range => isInRange(parsed, range));
}

export function isIpv6(ip: string): boolean {
  return ip.includes(":");
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");

  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  if (normalized.startsWith("fe80:") || normalized.startsWith("fe80::")) {
    return true;
  }

  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }

  if (normalized.startsWith("fec0:")) {
    return true;
  }

  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice(7);
    return isPrivateIpv4(ipv4Part);
  }

  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;

  const normalized = trimmed.replace(/^\[|\]$/g, "");

  if (isIpv6(normalized)) {
    return isPrivateIpv6(normalized);
  }

  return isPrivateIpv4(normalized);
}

export function isValidIpv4(ip: string): boolean {
  return parseIpv4(ip) !== null;
}

export function isValidIpv6(ip: string): boolean {
  const normalized = ip.replace(/^\[|\]$/g, "");
  if (!normalized.includes(":")) return false;

  const parts = normalized.split("::");
  if (parts.length > 2) return false;

  if (parts.length === 2) {
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    if (left.length + right.length > 7) return false;
  } else {
    const segments = normalized.split(":");
    if (segments.length !== 8) return false;
  }

  return true;
}

export function isValidIpAddress(ip: string): boolean {
  const trimmed = ip.trim();
  if (!trimmed) return false;

  const normalized = trimmed.replace(/^\[|\]$/g, "");

  if (isIpv6(normalized)) {
    return isValidIpv6(normalized);
  }

  return isValidIpv4(normalized);
}
