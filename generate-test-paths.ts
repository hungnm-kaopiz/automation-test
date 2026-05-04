/**
 * generate-test-paths.ts
 *
 * Replaces the manual a.md + patch-output-paths.ts workflow.
 * Reads SEO.csv, fetches real IDs from the master-data API per service scope,
 * and writes output.json with concrete app URLs and a `path` field.
 *
 * Required env:
 *   BASE_API_URL — e.g. http://localhost:8080/api/v1
 *   NEXT_PUBLIC_BASE_URL — e.g. http://localhost:3000
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { readSitemap } from "./parse-csv.ts";

import {
  buildFacilitiesQueryParams,
  detectFacilityServiceType,
  type FacilityServiceType,
  parseListingPath,
  readFacilityTotal,
  wardIdsForRegion,
} from "./path-facility-query.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env["BASE_API_URL"] ?? "http://localhost:8080/api/v1";
const BASE_URL = process.env["NEXT_PUBLIC_BASE_URL"] ?? "http://localhost:3000";
const SEO_CSV = path.resolve(__dirname, "SEO.csv");
const OUTPUT_FILE = path.resolve(__dirname, "output.json");

// ---------------------------------------------------------------------------
// Types (master-data API response shapes)
// ---------------------------------------------------------------------------

type SeoRow = {
  リダイレクト有無: string | null;
  パンくずの表記: string | null;
  titleタグ: string | null;
  Description: string | null;
  h1: string | null;
  fullpath: string;
  [key: string]: unknown;
};

type OutputRow = SeoRow & { path: string };

type Municipality = {
  id: number;
  prefecture_id: number;
  parent_id: number | null;
  hierarchy: number | null;
  name: string;
};

type Prefecture = {
  id: number;
  name: string;
  municipalities?: Municipality[];
};

type SearchTag = { id: number };
type DisabilityCategory = {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
};
type RailwayLine = { id: number; stations?: { id: number }[] };
type MunicipalitySummaryResource = { municipality_id: string; total: number };
type StationSummaryResource = { station_id: string; total: number };

// ---------------------------------------------------------------------------
// Scope → type_services[] mapping
// ---------------------------------------------------------------------------

type ScopeKey = "root" | "keizoku" | "type_a" | "type_b" | "ikou";

const SCOPE_TYPE_SERVICES: Record<ScopeKey, string[]> = {
  root: [],
  keizoku: ["type_a", "type_b"],
  type_a: ["type_a"],
  type_b: ["type_b"],
  ikou: ["type_i"],
};

/** IDs that vary per service scope — each resolved against the actual API with type_services filter. */
type ScopeIds = {
  prefectureId: number;
  municipalityId: number;
  regionMunicipalityId: number;
  wardId: number;
  stationId: number;
  lineId: number;
  tagId1: number;
  tagId2: number;
  disabilitySlug: string;
  hasStationTagCombo: boolean;
};

/** IDs shared across all scopes. */
type SharedIds = {
  facilityIdsByType: Record<FacilityServiceType, number[]>;
  corporateId: number | null;
  articleCategorySlug: string | null;
};

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchList<T>(endpoint: string): Promise<T[]> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[generate-paths] ${url} → HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { data?: T[] };
    return Array.isArray(json.data) ? json.data : [];
  } catch (err) {
    console.warn(
      `[generate-paths] ${url} → skipped (${(err as Error).message})`,
    );
    return [];
  }
}

/** Like fetchList but handles paginated endpoints where the response shape is
 *  { data: { data: T[], links: ..., meta: ... } } (e.g. /customer/facilities). */
async function fetchFacilitiesPage<T>(endpoint: string): Promise<T[]> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[generate-paths] ${url} → HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { data?: { data?: T[] } | T[] };
    const outer = json.data;
    if (Array.isArray(outer)) return outer;
    if (
      outer &&
      typeof outer === "object" &&
      Array.isArray((outer as { data?: T[] }).data)
    ) {
      return (outer as { data: T[] }).data;
    }
    return [];
  } catch (err) {
    console.warn(
      `[generate-paths] ${url} → skipped (${(err as Error).message})`,
    );
    return [];
  }
}

/** Calls the facilities endpoint and returns meta.total (0 on any error). */
const countCache = new Map<string, number>();

async function checkFacilityCount(endpoint: string): Promise<number> {
  if (countCache.has(endpoint)) return countCache.get(endpoint)!;

  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      countCache.set(endpoint, 0);
      return 0;
    }
    const total = readFacilityTotal(await res.json()) ?? 0;
    countCache.set(endpoint, total);
    return total;
  } catch {
    countCache.set(endpoint, 0);
    return 0;
  }
}

function typeParam(typeServices: string[]): string {
  return typeServices.map((t) => `type_services[]=${t}`).join("&");
}

// ---------------------------------------------------------------------------
// Per-scope ID resolution
// ---------------------------------------------------------------------------

async function resolveScopeIds(
  scope: ScopeKey,
  prefecturesById: Map<number, Prefecture>,
  stationLineMap: Map<number, number>,
  fallbackPrefId: number,
  candidateTags: SearchTag[],
  candidateDisabilities: DisabilityCategory[],
  forcedPrefId?: number,
): Promise<ScopeIds> {
  const types = SCOPE_TYPE_SERVICES[scope];
  const typeQuery = typeParam(types) ? `&${typeParam(types)}` : "";

  const sampleFacilities = forcedPrefId
    ? []
    : await fetchFacilitiesPage<{
        prefecture_id: number;
        municipality_id: number;
      }>(`/customer/facilities?limit=1${typeQuery}`);
  const sample = sampleFacilities[0];
  const prefId = forcedPrefId ?? sample?.prefecture_id ?? fallbackPrefId;
  const prefQuery = `prefecture_ids[]=${prefId}`;

  const prefData = prefecturesById.get(prefId);
  const allMunis = prefData?.municipalities ?? [];
  const muniById = new Map(allMunis.map((m) => [m.id, m]));

  const [muniSummaries, stationSummaries] = await Promise.all([
    fetchList<MunicipalitySummaryResource>(
      `/customer/facilities/municipality/summaries?prefecture_id=${prefId}${typeQuery}`,
    ),
    fetchList<StationSummaryResource>(
      `/customer/facilities/station/summaries?prefecture_id=${prefId}${typeQuery}`,
    ),
  ]);

  const summaryWithData = (s: MunicipalitySummaryResource) => {
    const id = Number(s.municipality_id);
    return s.total > 0 && muniById.has(id);
  };

  const flatMuniSummary = muniSummaries.find((s) => {
    const muni = muniById.get(Number(s.municipality_id));
    return summaryWithData(s) && muni?.parent_id == null;
  });
  const municipalityId = Number(
    flatMuniSummary?.municipality_id ??
      muniSummaries.find(summaryWithData)?.municipality_id ??
      sample?.municipality_id ??
      prefId,
  );

  // /region/{id} URLs only work for designated cities (parent city + ward districts).
  const wardsByParent = new Map<number, number[]>();
  for (const s of muniSummaries) {
    if (!summaryWithData(s)) continue;
    const muni = muniById.get(Number(s.municipality_id));
    if (muni?.parent_id == null) continue;
    const wards = wardsByParent.get(muni.parent_id) ?? [];
    wards.push(muni.id);
    wardsByParent.set(muni.parent_id, wards);
  }

  let regionMunicipalityId = municipalityId;
  let wardId = municipalityId;

  const regionChecks = await Promise.all(
    [...wardsByParent.entries()]
      .slice(0, 6)
      .map(async ([parentId, wardIds]) => {
        const wardChecks = await Promise.all(
          wardIds.slice(0, 3).map(async (wId) => ({
            wId,
            count: await checkFacilityCount(
              `/customer/facilities?limit=1&${prefQuery}&municipality_ids[]=${wId}${typeQuery}`,
            ),
          })),
        );
        const wardHit = wardChecks.find((w) => w.count > 0);
        return wardHit ? { parentId, wardId: wardHit.wId } : null;
      }),
  );
  const regionHit = regionChecks.find((hit) => hit != null);
  if (regionHit) {
    regionMunicipalityId = regionHit.parentId;
    wardId = regionHit.wardId;
  } else {
    console.warn(
      `[generate-paths] [${scope}] No designated city with ward data in prefecture ${prefId}`,
    );
  }

  const stationsWithData = stationSummaries
    .filter((s) => s.total > 0)
    .map((s) => Number(s.station_id));
  let stationId = stationsWithData[0] ?? 1;
  let lineId = stationLineMap.get(stationId) ?? 1;

  const tagResults = await Promise.all(
    candidateTags.slice(0, 6).map(async (tag) => ({
      id: tag.id,
      count: await checkFacilityCount(
        `/customer/facilities?limit=1&${prefQuery}&tag_ids[]=${tag.id}${typeQuery}`,
      ),
    })),
  );
  const validTags = tagResults.filter((t) => t.count > 0).map((t) => t.id);

  let tagId1 = validTags[0] ?? candidateTags[0]?.id ?? 2;
  let tagId2 = validTags[1] ?? validTags[0] ?? tagId1 + 1;

  if (validTags.length >= 2) {
    const pairResults = await Promise.all(
      validTags.slice(0, 4).flatMap((a, i, arr) =>
        arr.slice(i + 1, i + 3).map(async (b) => ({
          a,
          b,
          count: await checkFacilityCount(
            `/customer/facilities?limit=1&${prefQuery}&tag_ids[]=${a}&tag_ids[]=${b}${typeQuery}`,
          ),
        })),
      ),
    );
    const pair = pairResults.find((p) => p.count > 0);
    if (pair) {
      tagId1 = pair.a;
      tagId2 = pair.b;
    }
  }

  const tagCandidates = validTags.length > 0 ? validTags : [tagId1];

  async function findStationTagCombo(): Promise<{
    sid: number;
    tagId: number;
  } | null> {
    for (let i = 0; i < Math.min(stationsWithData.length, 45); i += 15) {
      const chunk = stationsWithData.slice(i, i + 15);
      const results = await Promise.all(
        chunk.flatMap((sid) =>
          tagCandidates.map(async (tagId) => ({
            sid,
            tagId,
            count: await checkFacilityCount(
              `/customer/facilities?limit=1&${prefQuery}&facility_stations_station_ids[]=${sid}&tag_ids[]=${tagId}${typeQuery}`,
            ),
          })),
        ),
      );
      const hit = results.find((r) => r.count > 0);
      if (hit) return { sid: hit.sid, tagId: hit.tagId };
    }
    return null;
  }

  const stationTagHit = await findStationTagCombo();
  if (stationTagHit) {
    stationId = stationTagHit.sid;
    tagId1 = stationTagHit.tagId;
    lineId = stationLineMap.get(stationId) ?? lineId;
  } else if (stationsWithData.length > 0 && tagCandidates.length > 0) {
    console.warn(
      `[generate-paths] [${scope}] No station+tag combo in prefecture ${prefId}; ` +
        `station/tag paths may fail validation`,
    );
  }

  const disabilityResults = await Promise.all(
    candidateDisabilities.slice(0, 6).map(async (dis) => ({
      slug: dis.slug,
      count: await checkFacilityCount(
        `/customer/facilities?limit=1&${prefQuery}&facility_disability_categories_ids[]=${dis.id}${typeQuery}`,
      ),
    })),
  );
  const disabilitySlug =
    disabilityResults.find((d) => d.count > 0)?.slug ??
    candidateDisabilities[0]?.slug ??
    "developmental";

  console.info(
    `[generate-paths] [${scope}] pref=${prefId} muni=${municipalityId} ` +
      `region=${regionMunicipalityId} ward=${wardId} station=${stationId} line=${lineId} ` +
      `tag1=${tagId1} tag2=${tagId2} disability=${disabilitySlug}`,
  );

  return {
    prefectureId: prefId,
    municipalityId,
    regionMunicipalityId,
    wardId,
    stationId,
    lineId,
    tagId1,
    tagId2,
    disabilitySlug,
    hasStationTagCombo: stationTagHit != null,
  };
}

async function fetchAllIds(): Promise<{
  scopes: Map<ScopeKey, ScopeIds>;
  shared: SharedIds;
  disabilityIdBySlug: Map<string, number>;
  municipalities: Municipality[];
  lineStationIdsByLineId: Map<number, number[]>;
}> {
  // One-time bulk fetches (no scope dependency).
  const [
    prefectures,
    searchTags,
    disabilities,
    railwayLines,
    typeAFacilities,
    typeBFacilities,
    typeIFacilities,
    facilitiesWithCorp,
  ] = await Promise.all([
    fetchList<Prefecture>(
      "/customer/master-data/prefectures?limit=50&with=municipalities",
    ),
    fetchList<SearchTag>("/customer/master-data/search-tags?limit=10"),
    fetchList<DisabilityCategory>(
      "/customer/master-data/disability-categories?limit=10",
    ),
    fetchList<RailwayLine>(
      "/customer/master-data/railway-lines?limit=2000&with=stations",
    ),
    fetchFacilitiesPage<{ id: number }>(
      "/customer/facilities?limit=3&type_services[]=type_a",
    ),
    fetchFacilitiesPage<{ id: number }>(
      "/customer/facilities?limit=3&type_services[]=type_b",
    ),
    fetchFacilitiesPage<{ id: number }>(
      "/customer/facilities?limit=3&type_services[]=type_i",
    ),
    fetchFacilitiesPage<{ id: number; corporation: { id: number } | null }>(
      "/customer/facilities?limit=10&with=corporation",
    ),
  ]);

  if (prefectures.length === 0) {
    throw new Error(
      `No prefectures returned from ${API_BASE}. Set BASE_API_URL and ensure the API is running.`,
    );
  }

  const prefecturesById = new Map(prefectures.map((p) => [p.id, p]));
  const fallbackPrefId = prefectures[0]!.id;

  // Build station → line lookup from the full railway-lines list.
  const stationLineMap = new Map<number, number>();
  for (const line of railwayLines) {
    for (const station of line.stations ?? []) {
      stationLineMap.set(station.id, line.id);
    }
  }

  // Prepare disability candidates (active, sorted).
  const activeDisabilities = disabilities
    .filter((d) => d.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  // Resolve all scopes in parallel — each scope now makes ~15 batched API calls.
  const scopeKeys: ScopeKey[] = ["root", "keizoku", "type_a", "type_b", "ikou"];
  const scopeResults = await Promise.all(
    scopeKeys.map((scope) =>
      resolveScopeIds(
        scope,
        prefecturesById,
        stationLineMap,
        fallbackPrefId,
        searchTags,
        activeDisabilities,
      ),
    ),
  );

  // type_a station+tag pages need a prefecture where that combo exists.
  const typeAIndex = scopeKeys.indexOf("type_a");
  let typeAIds = scopeResults[typeAIndex]!;
  if (!typeAIds.hasStationTagCombo) {
    const altFacilities = await fetchFacilitiesPage<{ prefecture_id: number }>(
      "/customer/facilities?limit=20&type_services[]=type_a",
    );
    const altPrefs = [
      ...new Set(
        altFacilities
          .map((f) => f.prefecture_id)
          .filter((id) => id !== typeAIds.prefectureId),
      ),
    ].slice(0, 3);

    for (const altPref of altPrefs) {
      const altIds = await resolveScopeIds(
        "type_a",
        prefecturesById,
        stationLineMap,
        fallbackPrefId,
        searchTags,
        activeDisabilities,
        altPref,
      );
      if (altIds.hasStationTagCombo) {
        typeAIds = altIds;
        console.info(
          `[generate-paths] [type_a] switched to prefecture ${altPref} for station+tag data`,
        );
        break;
      }
    }
    scopeResults[typeAIndex] = typeAIds;
  }

  const scopes = new Map<ScopeKey, ScopeIds>(
    scopeKeys.map((key, i) => [key, scopeResults[i]!]),
  );

  // Shared IDs (not scope-dependent).
  const toFacilityIds = (
    list: { id: number }[],
    fallback: number,
  ): number[] => {
    const ids = list.map((f) => f.id);
    return ids.length > 0 ? ids : [fallback];
  };
  const corporateId =
    facilitiesWithCorp.find((f) => f.corporation != null)?.corporation?.id ??
    null;
  const articleCategorySlug =
    process.env["ARTICLE_CATEGORY_SLUG"] ?? DEFAULT_ARTICLE_CATEGORY_SLUG;

  const lineStationIdsByLineId = new Map<number, number[]>(
    railwayLines.map((line) => [
      line.id,
      (line.stations ?? []).map((s) => s.id),
    ]),
  );

  return {
    scopes,
    shared: {
      facilityIdsByType: {
        type_a: toFacilityIds(typeAFacilities, 1),
        type_b: toFacilityIds(typeBFacilities, 2),
        type_i: toFacilityIds(typeIFacilities, 3),
      },
      corporateId,
      articleCategorySlug,
    },
    disabilityIdBySlug: new Map(activeDisabilities.map((d) => [d.slug, d.id])),
    municipalities: prefectures.flatMap((p) => p.municipalities ?? []),
    lineStationIdsByLineId,
  };
}

// ---------------------------------------------------------------------------
// Path transformation
// ---------------------------------------------------------------------------

const URL_SCOPE_SEGMENTS = new Set([
  "keizoku",
  "ikou",
  "type_a",
  "type_b",
  "all",
]);

function getScopeKey(scopeSegments: string[]): ScopeKey {
  if (scopeSegments.includes("type_a")) return "type_a";
  if (scopeSegments.includes("type_b")) return "type_b";
  if (scopeSegments.includes("keizoku")) return "keizoku";
  if (scopeSegments.includes("ikou")) return "ikou";
  return "root";
}

function toPathField(fullUrl: string): string {
  const pathname = new URL(fullUrl).pathname;
  return pathname.endsWith("/") ? pathname : `${pathname}/`;
}

function joinUrl(segments: string[]): string {
  return `${BASE_URL}/${segments.join("/")}/`;
}

const DEFAULT_ARTICLE_CATEGORY_SLUG = "swt68muov";
const DEFAULT_ARTICLE_TAG_SLUG = "1z-n9b9yb_sk";
const DEFAULT_ARTICLE_DETAIL_SLUG = "aju_kk-cmye";

/** Map SEO template article paths to concrete CMS slugs. */
function finalizeArticleUrl(url: string): string {
  const categorySlug =
    process.env["ARTICLE_CATEGORY_SLUG"] ?? DEFAULT_ARTICLE_CATEGORY_SLUG;
  const tagSlug = process.env["ARTICLE_TAG_SLUG"] ?? DEFAULT_ARTICLE_TAG_SLUG;
  const detailSlug =
    process.env["ARTICLE_DETAIL_SLUG"] ?? DEFAULT_ARTICLE_DETAIL_SLUG;

  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return url;
  }

  const normalized = pathname.replace(/\/+$/, "") || "/";
  let next: string | undefined;

  if (normalized === "/rakita/articles/category") {
    next = `/rakita/articles/category/${categorySlug}/`;
  } else if (normalized === "/rakita/articles/tag") {
    next = `/rakita/articles/tag/${tagSlug}/`;
  } else if (normalized === "/rakita/articles/category/12345") {
    next = `/rakita/articles/${detailSlug}/`;
  }

  if (!next) return url;
  return `${BASE_URL}${next}`;
}

type Counters = Record<FacilityServiceType, number>;

function transformPath(
  row: SeoRow,
  scopes: Map<ScopeKey, ScopeIds>,
  shared: SharedIds,
  counters: Counters,
): string {
  const seoFullpath = row.fullpath;
  const segments = new URL(seoFullpath).pathname
    .replace(/\/$/, "")
    .split("/")
    .filter(Boolean);

  // segments[0] === 'rakita'
  const out: string[] = ["rakita"];
  let i = 1;
  const scopeSegments: string[] = [];

  while (i < segments.length && URL_SCOPE_SEGMENTS.has(segments[i]!)) {
    out.push(segments[i]!);
    scopeSegments.push(segments[i]!);
    i++;
  }

  const ids = scopes.get(getScopeKey(scopeSegments))!;

  if (i >= segments.length) {
    return joinUrl(out);
  }

  const seg = segments[i]!;

  // --- facility ---
  if (seg === "facility") {
    out.push("facility");
    i++;
    if (i < segments.length && /^\d+$/.test(segments[i] ?? "")) {
      const serviceType = detectFacilityServiceType(
        row.titleタグ,
        row.Description,
        row.パンくずの表記,
      );
      const pool = shared.facilityIdsByType[serviceType];
      const idx = counters[serviceType] % pool.length;
      counters[serviceType]++;
      out.push(String(pool[idx]));
    }
    return joinUrl(out);
  }

  // --- facility_brands (excluded from output) ---
  if (seg === "facility_brands") {
    return "";
  }

  // --- facility_corporate ---
  if (seg === "facility_corporate") {
    out.push("facility_corporate");
    i++;
    if (i < segments.length) {
      out.push(String(shared.corporateId ?? segments[i]!));
    }
    return joinUrl(out);
  }

  // --- articles: CMS slugs in SEO.csv are already real — just change domain.
  //     Numeric segments are placeholders (e.g. 12345 for a category slug);
  //     replace from ARTICLE_CATEGORY_SLUG env var or skip the row. ---
  if (seg === "articles") {
    for (; i < segments.length; i++) {
      const s = segments[i]!;
      if (/^\d+$/.test(s)) {
        if (!shared.articleCategorySlug) return "";
        out.push(shared.articleCategorySlug);
      } else {
        out.push(s);
      }
    }
    return joinUrl(out);
  }

  // --- regular listing page ---
  if (/^\d+$/.test(seg)) {
    out.push(String(ids.prefectureId));
    i++;
  }

  while (i < segments.length) {
    const s = segments[i]!;

    if (s === "region") {
      out.push("region");
      i++;
      if (i < segments.length && /^\d+$/.test(segments[i] ?? "")) {
        out.push(String(ids.regionMunicipalityId));
        i++;
        if (i < segments.length && /^\d+$/.test(segments[i] ?? "")) {
          out.push(String(ids.wardId));
          i++;
        }
      }
      continue;
    }

    if (s === "station") {
      out.push("station");
      i++;
      if (i < segments.length && /^\d+$/.test(segments[i] ?? "")) {
        out.push(String(ids.stationId));
        i++;
      }
      continue;
    }

    if (s === "lines") {
      out.push("lines");
      i++;
      if (i < segments.length && /^\d+$/.test(segments[i] ?? "")) {
        out.push(String(ids.lineId));
        i++;
      }
      continue;
    }

    if (s === "tag") {
      out.push("tag");
      i++;
      let tagIdx = 0;
      while (i < segments.length && /^\d+$/.test(segments[i] ?? "")) {
        out.push(String(tagIdx === 0 ? ids.tagId1 : ids.tagId2));
        tagIdx++;
        i++;
      }
      continue;
    }

    if (/^\d+$/.test(s)) {
      out.push(String(ids.municipalityId));
      i++;
      continue;
    }

    // disability slug placeholder (e.g. "xxx")
    out.push(ids.disabilitySlug);
    i++;
  }

  return joinUrl(out);
}

// ---------------------------------------------------------------------------
// Post-generation validation
// ---------------------------------------------------------------------------

async function validateListingPaths(
  rows: OutputRow[],
  disabilityIdBySlug: Map<string, number>,
  municipalities: Municipality[],
  lineStationIdsByLineId: Map<number, number[]>,
): Promise<void> {
  const disabilitySlugs = new Set(disabilityIdBySlug.keys());
  const failures: string[] = [];
  const seenQueries = new Set<string>();

  const checks = rows.flatMap((row) => {
    const parsed = parseListingPath(row.path, disabilitySlugs);
    if (parsed.isNonListingPage) return [];

    const params = buildFacilitiesQueryParams(parsed, disabilityIdBySlug, {
      regionWardIds:
        parsed.regionMunicipalityId != null && parsed.wardId == null
          ? wardIdsForRegion(municipalities, parsed.regionMunicipalityId)
          : undefined,
      lineStationIds:
        parsed.lineId != null
          ? lineStationIdsByLineId.get(parsed.lineId)
          : undefined,
    });
    const queryKey = params.toString();
    if (seenQueries.has(queryKey)) return [];
    seenQueries.add(queryKey);

    return [
      { pathname: row.path, endpoint: `/customer/facilities?${queryKey}` },
    ];
  });

  const results = await Promise.all(
    checks.map(async ({ pathname, endpoint }) => ({
      pathname,
      endpoint,
      count: await checkFacilityCount(endpoint),
    })),
  );

  for (const { pathname, endpoint, count } of results) {
    if (count === 0) {
      failures.push(
        `${pathname} → 0 facilities (${endpoint.replace("/customer/facilities?", "")})`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `[generate-paths] ${failures.length} unique listing query(s) returned 0 facilities:`,
    );
    for (const line of failures) {
      console.error(`  • ${line}`);
    }
    throw new Error(
      `${failures.length} generated listing URL(s) have no facility data. ` +
        "Ensure BASE_API_URL points to an environment with facility records.",
    );
  }

  console.info(
    `[generate-paths] Validated ${checks.length} unique listing queries — all have facility data`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  console.info(`[generate-paths] BASE_API_URL=${API_BASE}`);

  const seoRows = readSitemap(SEO_CSV) as SeoRow[];
  console.info(`[generate-paths] Loaded ${seoRows.length} rows from SEO.csv`);

  const {
    scopes,
    shared,
    disabilityIdBySlug,
    municipalities,
    lineStationIdsByLineId,
  } = await fetchAllIds();

  const counters: Counters = { type_a: 0, type_b: 0, type_i: 0 };
  const result: OutputRow[] = [];

  for (const row of seoRows) {
    const fullpath = finalizeArticleUrl(
      transformPath(row, scopes, shared, counters),
    );
    if (!fullpath) continue; // facility_brands rows are excluded

    result.push({ ...row, fullpath, path: toPathField(fullpath) });
  }

  await validateListingPaths(
    result,
    disabilityIdBySlug,
    municipalities,
    lineStationIdsByLineId,
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf-8",
  );
  console.info(`✅ Wrote ${result.length} entries → ${OUTPUT_FILE}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
