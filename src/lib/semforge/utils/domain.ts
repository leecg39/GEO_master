export function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const withProtocol = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const hostname = new URL(withProtocol).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    return trimmed.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

export function projectDomainFromBrand(brandName: string, website?: string | null): string {
  if (website?.trim()) {
    const domain = normalizeDomain(website);
    if (domain.includes(".")) return domain;
  }
  const slug = brandName.trim().toLowerCase().replace(/\s+/g, "");
  return slug ? `${slug}.com` : "";
}
