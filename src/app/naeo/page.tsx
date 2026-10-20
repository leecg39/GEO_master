import type { Metadata } from "next";
import { NaeoHubClient } from "@/components/NaeoHubClient";

export const metadata: Metadata = { title: "Naeo" };

/** http/https 주소만 실행 링크로 쓴다. 그 외 값은 미설정으로 취급한다. */
function serviceUrlFromEnv(): string | null {
  const raw = process.env.NAEO_SERVICE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function NaeoPage() {
  return <NaeoHubClient serviceUrl={serviceUrlFromEnv()} />;
}
