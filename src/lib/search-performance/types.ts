export const MAX_GSC_FILE_BYTES = 5 * 1024 * 1024;

export interface SearchMetricRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
}

export interface SearchPerformanceReport {
  periodStart: string;
  periodEnd: string;
  timezone: "America/Los_Angeles";
  searchType: string;
  filters: Array<[string, string]>;
  daily: SearchMetricRow[];
  tables: Array<{ name: string; rows: SearchMetricRow[] }>;
  totals: Omit<SearchMetricRow, "key">;
  dataState: "no_activity" | "measured";
}

export interface SearchPerformanceImport {
  id: number;
  platform: string;
  propertyUrl: string;
  filename: string;
  importedAt: string;
  periodStart: string;
  periodEnd: string;
  source: "gsc_excel";
  dataState: SearchPerformanceReport["dataState"];
  totals: SearchPerformanceReport["totals"];
}

export interface SearchPerformanceList {
  project: { id: number; name: string };
  imports: SearchPerformanceImport[];
}
