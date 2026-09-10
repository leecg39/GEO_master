import { promises as dns } from "node:dns";
import http, { type IncomingHttpHeaders, type RequestOptions } from "node:http";
import https from "node:https";
import net from "node:net";
import { AppError } from "./errors";

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home", ".lan"];
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function ipv4ToNumber(value: string) {
  return value.split(".").reduce((total, part) => (total << 8) + Number(part), 0) >>> 0;
}

function inCidr(value: string, network: string, bits: number) {
  const ip = ipv4ToNumber(value);
  const base = ipv4ToNumber(network);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (net.isIPv4(normalized)) {
    return [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
      ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
      ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
      ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
      ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([network, bits]) => inCidr(normalized, network as string, bits as number));
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
    // 전환 주소는 내부 IPv4를 우회 표현할 수 있어 진단 대상에서 보수적으로 제외한다.
    if (normalized.startsWith("2002:") || /^2001:0{0,3}0:/.test(normalized)) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mapped) return isPrivateAddress(mapped);
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const high = Number.parseInt(mappedHex[1], 16);
      const low = Number.parseInt(mappedHex[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return false;
  }
  return true;
}

export function normalizePublicUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError("http 또는 https로 시작하는 올바른 URL을 입력해 주세요.", 422, "INVALID_URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError("http와 https URL만 진단할 수 있습니다.", 422, "INVALID_PROTOCOL");
  }
  if (url.username || url.password) {
    throw new AppError("인증 정보가 포함된 URL은 허용되지 않습니다.", 422, "URL_CREDENTIALS_BLOCKED");
  }
  if ((url.protocol === "http:" && url.port && url.port !== "80") || (url.protocol === "https:" && url.port && url.port !== "443")) {
    throw new AppError("표준 웹 포트(80/443)만 진단할 수 있습니다.", 422, "PORT_BLOCKED");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new AppError("내부 네트워크 주소는 진단할 수 없습니다.", 403, "PRIVATE_HOST_BLOCKED");
  }
  url.hash = "";
  return url;
}

export function isSamePublicSite(url: URL, origin: string): boolean {
  let allowed: URL;
  try {
    allowed = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== allowed.protocol) return false;
  const portOf = (value: URL) => value.port || (value.protocol === "https:" ? "443" : "80");
  if (portOf(url) !== portOf(allowed)) return false;
  const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return hostKey(url.hostname) === hostKey(allowed.hostname);
}

interface ResolvedPublicUrl {
  url: URL;
  address: string;
}

export function selectPublicAddress(addresses: string[]) {
  if (!addresses.length || addresses.some((address) => isPrivateAddress(address))) {
    throw new AppError("사설 또는 예약 IP로 연결되는 도메인은 진단할 수 없습니다.", 403, "PRIVATE_IP_BLOCKED");
  }
  return addresses[0];
}

export function createPinnedLookup(address: string): NonNullable<RequestOptions["lookup"]> {
  if (isPrivateAddress(address)) {
    throw new AppError("사설 또는 예약 IP 주소는 진단할 수 없습니다.", 403, "PRIVATE_IP_BLOCKED");
  }
  const family = net.isIPv6(address) ? 6 : 4;
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

async function resolvePublicUrl(input: string | URL): Promise<ResolvedPublicUrl> {
  const url = input instanceof URL ? normalizePublicUrl(input.toString()) : normalizePublicUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return { url, address: selectPublicAddress([hostname]) };
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError("도메인의 IP 주소를 확인할 수 없습니다.", 422, "DNS_LOOKUP_FAILED");
  }
  return { url, address: selectPublicAddress(addresses.map(({ address }) => address)) };
}

export async function assertPublicUrl(input: string | URL) {
  return (await resolvePublicUrl(input)).url;
}

interface PinnedResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function headerText(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name];
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

export interface PublicRequestOptions {
  signal?: AbortSignal;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  userAgent?: string;
  accept?: string;
  maxBytes?: number;
}

function requestPinned(
  resolved: ResolvedPublicUrl,
  options: PublicRequestOptions | number = {},
): Promise<PinnedResponse> {
  const normalized = typeof options === "number" ? { timeoutMs: options } : options;
  const timeoutMs = normalized.timeoutMs ?? 12_000;
  const maxBytes = normalized.maxBytes ?? MAX_BYTES;
  const method = normalized.method ?? "GET";
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof AppError ? error : new AppError("대상 사이트에 연결하지 못했습니다.", 502, "FETCH_FAILED"));
    };
    const transport = resolved.url.protocol === "https:" ? https : http;
    const request = transport.request(resolved.url, {
      method,
      signal: normalized.signal ? AbortSignal.any([normalized.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
      lookup: createPinnedLookup(resolved.address),
      headers: {
        "user-agent": normalized.userAgent ?? "GEO-Master-Audit/1.0 (+local diagnostic tool)",
        accept: normalized.accept ?? "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        connection: "close",
        ...normalized.headers,
      },
    }, (response) => {
      const declared = Number(headerText(response.headers, "content-length") || 0);
      if (declared > maxBytes) {
        response.destroy();
        fail(new AppError("대상 문서가 2MB 제한을 초과합니다.", 413, "RESPONSE_TOO_LARGE"));
        return;
      }
      const encoding = headerText(response.headers, "content-encoding").toLowerCase();
      if (encoding && encoding !== "identity") {
        response.destroy();
        fail(new AppError("압축되지 않은 문서만 진단할 수 있습니다.", 422, "COMPRESSED_RESPONSE_BLOCKED"));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > maxBytes) {
          response.destroy();
          fail(new AppError("대상 문서가 2MB 제한을 초과합니다.", 413, "RESPONSE_TOO_LARGE"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", fail);
      response.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          text: Buffer.concat(chunks, total).toString("utf8"),
        });
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("request timeout")));
    request.on("error", fail);
    if (normalized.body) request.write(normalized.body);
    request.end();
  });
}

export interface FetchedText {
  url: string;
  status: number;
  text: string;
  contentType: string;
  robotsHeader?: string;
  /** SEO-relevant response headers only. Never cookies or authorization. */
  seoHeaders?: Record<string, string>;
}

export async function fetchPublicText(input: string, timeoutMs = 12_000, options: { origin?: string; signal?: AbortSignal } = {}): Promise<FetchedText> {
  const checkScope = (url: URL) => {
    if (options.origin && !isSamePublicSite(url, options.origin)) throw new AppError("연결된 사이트 범위를 벗어난 URL입니다.", 422, "SITE_SCOPE_MISMATCH");
    options.signal?.throwIfAborted();
  };
  checkScope(normalizePublicUrl(input));
  let resolved = await resolvePublicUrl(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    checkScope(resolved.url);
    const response = await requestPinned(resolved, { timeoutMs, signal: options.signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = headerText(response.headers, "location");
      if (!location) throw new AppError("리다이렉트 위치가 비어 있습니다.", 502, "INVALID_REDIRECT");
      if (redirect === MAX_REDIRECTS) throw new AppError("리다이렉트가 너무 많습니다.", 422, "TOO_MANY_REDIRECTS");
      const next = new URL(location, resolved.url);
      checkScope(next);
      resolved = await resolvePublicUrl(next);
      continue;
    }
    return {
      url: resolved.url.toString(),
      status: response.status,
      text: response.text,
      contentType: headerText(response.headers, "content-type"),
      robotsHeader: headerText(response.headers, "x-robots-tag"),
      seoHeaders: Object.fromEntries(
        ["content-type", "content-language", "x-robots-tag", "last-modified"]
          .map((name) => [name, headerText(response.headers, name)]),
      ),
    };
  }
  throw new AppError("대상 사이트를 가져오지 못했습니다.", 502, "FETCH_FAILED");
}

/** SSRF-safe JSON request (Application Password / REST). Mutating methods reject redirects. */
export async function requestPublicJson<T = unknown>(
  input: string,
  options: PublicRequestOptions = {},
): Promise<{ url: string; status: number; json: T; text: string }> {
  const method = options.method ?? "GET";
  const resolved = await resolvePublicUrl(input);
  const response = await requestPinned(resolved, {
    ...options,
    method,
    timeoutMs: options.timeoutMs ?? 20_000,
    maxBytes: options.maxBytes ?? MAX_BYTES,
    accept: options.accept ?? "application/json",
    userAgent: options.userAgent ?? "GEO-Master-WordPress/1.0 (+draft publish adapter)",
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  });
  if ([301, 302, 303, 307, 308].includes(response.status) && method !== "GET") {
    throw new AppError("WordPress API 리다이렉트는 허용되지 않습니다.", 502, "WP_REDIRECT_BLOCKED");
  }
  let json: T;
  try {
    json = JSON.parse(response.text || "null") as T;
  } catch {
    throw new AppError("WordPress가 JSON이 아닌 응답을 반환했습니다.", 502, "WP_INVALID_JSON");
  }
  return { url: resolved.url.toString(), status: response.status, json, text: response.text };
}
