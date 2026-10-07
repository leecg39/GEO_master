import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { z } from "zod";
import { errorResponse } from "@/lib/errors";
import { buildJsonLd, checkAgainstPage, JSON_LD_TYPES, validateJsonLd } from "@/lib/structured-data";
import { fetchPublicText } from "@/lib/url-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const str = z.string().trim().max(2000);
const bodySchema = z.object({
  type: z.enum(JSON_LD_TYPES),
  input: z.object({
    name: str.optional(), url: str.optional(), description: str.optional(), logo: str.optional(), sameAs: z.array(str).max(20).optional(),
    price: str.optional(), priceCurrency: str.optional(), ratingValue: str.optional(), ratingCount: str.optional(), availability: str.optional(),
    headline: str.optional(), datePublished: str.optional(), authorName: str.optional(),
    items: z.array(z.object({ name: str, url: str })).max(20).optional(),
    evidence: z.record(z.string(), str).optional(),
  }).strict(),
  pageUrl: z.string().trim().max(2048).url().refine((value) => /^https?:\/\//i.test(value), { message: "http 또는 https URL만 허용합니다." }).optional(),
}).strict();

function pageJsonLd(html: string): Record<string, unknown>[] {
  const $ = cheerio.load(html);
  return $("script[type='application/ld+json']").toArray().flatMap((el) => {
    try {
      const parsed = JSON.parse($(el).text());
      return (Array.isArray(parsed) ? parsed : [parsed]).filter((node) => node && typeof node === "object");
    } catch { return []; }
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = bodySchema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: "입력이 올바르지 않습니다.", code: "VALIDATION_ERROR", details: body.error.issues.map((issue) => issue.message) }, { status: 422 });
    const { type, input, pageUrl } = body.data;
    const built = buildJsonLd(type, input);
    let blocking: ReturnType<typeof checkAgainstPage>["blocking"] = [];
    let duplicates: ReturnType<typeof checkAgainstPage>["duplicates"] = [];
    const issues = built.jsonLd ? validateJsonLd(built.jsonLd) : [];
    if (built.jsonLd && pageUrl) {
      const page = await fetchPublicText(pageUrl, 10_000);
      if (page.status < 200 || page.status >= 400) return NextResponse.json({ error: `페이지를 읽지 못했습니다 (HTTP ${page.status}).`, code: "PAGE_FETCH_FAILED" }, { status: 502 });
      const $ = cheerio.load(page.text);
      $("script, style, noscript").remove();
      ({ blocking, duplicates } = checkAgainstPage(built.jsonLd, $("body").text().replace(/\s+/g, " "), pageJsonLd(page.text)));
    }
    const publishable = Boolean(built.jsonLd) && !built.blocked.length && !issues.some((issue) => issue.severity === "error") && !blocking.length;
    return NextResponse.json({ ...built, issues, blocking, duplicates, pageChecked: Boolean(pageUrl), publishable });
  } catch (error) { return errorResponse(error); }
}
