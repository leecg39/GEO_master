export async function haloApi<T>(url: string, projectId: number, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, cache: "no-store", headers: { "content-type": "application/json", "x-geo-project-id": String(projectId) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data as T;
}
export function safeExternalUrl(value: string) {
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
/** Fixed KST formatting keeps server rendering and browser hydration identical. */
export function formatHaloTime(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? `${new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ")} KST` : "시각 미상";
}
