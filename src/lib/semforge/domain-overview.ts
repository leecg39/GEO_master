import type { PositionTrackingBriefingData } from "@/lib/semforge/position-tracking/briefing";

export interface DomainAnalyticsDashboardData {
  domain: string;
  gscConnected: boolean;
  siteHealth: number | null;
  lastSiteAuditAt: string | null;
  position: {
    campaignCount: number;
    primary: { id: number; name: string; visibility: number; updatedAt: string | null } | null;
    briefing: PositionTrackingBriefingData | null;
    campaigns: Array<{ id: number; name: string; visibility: number; keywordCount: number; updatedAt: string | null }>;
  };
  aiSeo: {
    queryCount: number;
    collectedCount: number;
    aioCount: number;
    citedCount: number;
    lastCollectedAt: string | null;
  };
  siteAudits: Array<{ id: number; name: string; siteHealth: number | null; status: string; lastRunAt: string | null }>;
  narratives: string[];
  recommendations: string[];
  links: Array<{ href: string; label: string; description: string }>;
}
