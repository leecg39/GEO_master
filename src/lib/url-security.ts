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

function requestPinned(resolved: ResolvedPublicUrl, timeoutMs: number): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof AppError ? error : new AppError("대상 사이트에 연결하지 못했습니다.", 502, "FETCH_FAILED"));
    };
    const transport = resolved.url.protocol === "https:" ? https : http;
    const request = transport.request(resolved.url, {
      method: "GET",
      lookup: createPinnedLookup(resolved.address),
      headers: {
        "user-agent": "GEO-Master-Audit/1.0 (+local diagnostic tool)",
        accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        connection: "close",
      },
    }, (response) => {
      const declared = Number(headerText(response.headers, "content-length") || 0);
      if (declared > MAX_BYTES) {
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
        if (total > MAX_BYTES) {
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
    request.end();
  });
}

export interface FetchedText {
  url: string;
  status: number;
  text: string;
  contentType: string;
}

export async function fetchPublicText(input: string, timeoutMs = 12_000): Promise<FetchedText> {
  let resolved = await resolvePublicUrl(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await requestPinned(resolved, timeoutMs);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = headerText(response.headers, "location");
      if (!location) throw new AppError("리다이렉트 위치가 비어 있습니다.", 502, "INVALID_REDIRECT");
      if (redirect === MAX_REDIRECTS) throw new AppError("리다이렉트가 너무 많습니다.", 422, "TOO_MANY_REDIRECTS");
      resolved = await resolvePublicUrl(new URL(location, resolved.url));
      continue;
    }
    return {
      url: resolved.url.toString(),
      status: response.status,
      text: response.text,
      contentType: headerText(response.headers, "content-type"),
    };
  }
  throw new AppError("대상 사이트를 가져오지 못했습니다.", 502, "FETCH_FAILED");
}
