/**
 * Resolve geo/metadata slots in output.json via master-data API.
 *
 * Reads:  output.json (template slots normalized in-memory)
 * Writes: output.final.json (same shape; all slots resolved to literals)
 *
 * Required env:
 *   BASE_API_URL — e.g. http://localhost:8080/api/v1
 *
 * v1 scope:
 *   - Resolves {prefecture}, {city}, {ward} from path IDs + master data
 *   - Resolves {tag}/{tag1}/{tag2}, {line}, {disability} (URL slug), {supportedDisabilities} (facility-specific or master default), facility slots when straightforward
 *   - Resolves {count} via GET /customer/facilities?limit=1 with path-derived filters
 *   - Article CMS pages: copy live title/description/h1/breadcrumb from NEXT_PUBLIC_BASE_URL
 *   - Leaves {station}, etc. when lookup fails (logged as warnings)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";

import {
  assertResolvedTitleParenStyle,
  normalizeItem,
} from "./normalize-seo.js";

import {
  buildFacilitiesQueryParams,
  detectFacilityServiceType,
  type FacilityServiceType,
  parseListingPath,
  readFacilityTotal,
  wardIdsForRegion,
} from "./path-facility-query.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env["BASE_API_URL"] ?? "http://localhost:8080/api/v1";
const APP_BASE = process.env["NEXT_PUBLIC_BASE_URL"] ?? "http://localhost:3000";
const INPUT_FILE = path.resolve(__dirname, "output.json");
const OUTPUT_FILE = path.resolve(__dirname, "output.final.json");

type NormalizedFields = {
  fullpath: string;
  title: string;
  description: string;
  h1?: string;
  breadcrumb?: string;
};

type OutputEntry = {
  fullpath: string;
  path?: string;
  scope?: string;
  titleタグ: string;
  Description: string;
  h1?: string;
  パンくずの表記?: string;
  [key: string]: unknown;
};

const entryToFields = (entry: OutputEntry): NormalizedFields => {
  const fields: NormalizedFields = {
    fullpath: entry.fullpath,
    title: entry.titleタグ,
    description: entry.Description,
  };

  if (entry.h1) fields.h1 = entry.h1;
  if (entry.パンくずの表記) fields.breadcrumb = entry.パンくずの表記;

  return fields;
};

const applyResolvedFields = (
  entry: OutputEntry,
  resolved: NormalizedFields,
): OutputEntry => {
  const updated: OutputEntry = {
    ...entry,
    fullpath: resolved.fullpath,
    titleタグ: resolved.title,
    Description: resolved.description,
  };

  if (resolved.h1) updated.h1 = resolved.h1;
  if (resolved.breadcrumb) updated.パンくずの表記 = resolved.breadcrumb;

  return updated;
};

type ParsedPath = {
  prefectureId?: number;
  municipalityId?: number;
  regionMunicipalityId?: number;
  wardId?: number;
  stationId?: number;
  lineId?: number;
  tagIds: number[];
  disabilitySlug?: string;
  facilityId?: number;
  corporateId?: number;
  /** API type_services[] values derived from URL scope segments (keizoku/ikou/type_a/type_b/all). */
  typeServices?: string[];
  /** true if this is an articles/facility-detail/corporate page (no facility count to fetch). */
  isNonListingPage?: boolean;
};

type GeoValues = {
  prefecture?: string;
  city?: string;
  ward?: string;
};

function toGeoValues(
  prefecture: string | undefined,
  city?: string | undefined,
  ward?: string | undefined,
): GeoValues {
  const geo: GeoValues = {};
  if (prefecture) geo.prefecture = prefecture;
  if (city !== undefined) geo.city = city;
  if (ward) geo.ward = ward;
  return geo;
}

type FacilityDetails = {
  facilityName?: string;
  companyName?: string;
  corporateName?: string;
  prefecture?: string;
  city?: string;
  supportedDisabilities?: string;
};

function toFacilityDetails(parts: {
  facilityName?: string | undefined;
  companyName?: string | undefined;
  corporateName?: string | undefined;
  prefecture?: string | undefined;
  city?: string | undefined;
  supportedDisabilities?: string | undefined;
}): FacilityDetails {
  const details: FacilityDetails = {};
  if (parts.facilityName !== undefined)
    details.facilityName = parts.facilityName;
  if (parts.companyName !== undefined) details.companyName = parts.companyName;
  if (parts.corporateName !== undefined)
    details.corporateName = parts.corporateName;
  if (parts.prefecture) details.prefecture = parts.prefecture;
  if (parts.city) details.city = parts.city;
  if (parts.supportedDisabilities !== undefined) {
    details.supportedDisabilities = parts.supportedDisabilities;
  }
  return details;
}

type SearchTagType =
  | "availability_type"
  | "access_type"
  | "welfare_benefit"
  | "job_description"
  | "industry_category"
  | "occupational_category"
  | "wage_salary_type";

type NamedMasterResource = { id: number; name: string | null | undefined };

type MunicipalityResource = { id: number; name: string };

type PrefectureResource = {
  id: number;
  name: string;
  municipalities?: MunicipalityResource[];
};

type SearchTagResource = {
  id: number;
  master_id: number;
  tag_type: SearchTagType;
};

type DisabilityCategoryResource = {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
};

type RailwayLineResource = {
  id: number;
  name: string;
  stations?: StationResource[];
};

type StationResource = { id: number; name: string };

type FacilityResource = {
  prefecture_id?: number;
  municipality_id?: number;
  disability_categories?: DisabilityCategoryResource[];
  facility_detail?: {
    name?: string;
    corporate_name?: string;
  };
};

type MasterData = {
  prefecturesById: Map<number, PrefectureResource>;
  municipalitiesById: Map<number, MunicipalityResource>;
  searchTagsById: Map<number, SearchTagResource>;
  availabilityTypesById: Map<number, NamedMasterResource>;
  accessTypesById: Map<number, NamedMasterResource>;
  welfareBenefitsById: Map<number, NamedMasterResource>;
  jobDescriptionsById: Map<number, NamedMasterResource>;
  industryCategoriesById: Map<number, NamedMasterResource>;
  occupationalCategoriesById: Map<number, NamedMasterResource>;
  wageSalaryTypesById: Map<number, NamedMasterResource>;
  disabilitiesBySlug: Map<string, DisabilityCategoryResource>;
  /** All active disability category names joined by "、" (fixed default for {supportedDisabilities}). */
  defaultSupportedDisabilities: string;
  linesById: Map<number, RailwayLineResource>;
  stationsById: Map<number, StationResource>;
  /** First real facility IDs from the sitemap (fallback when typed fetch fails). */
  firstFacilityIds: number[];
  /** Facility IDs per type_service for facility detail placeholder replacement. */
  facilityIdsByType: Record<FacilityServiceType, number[]>;
  /** First real corporate ID from the sitemap (used to replace placeholder 12345). */
  firstCorporateId: number | undefined;
  /** First real station ID available (fallback when path station ID is missing). */
  firstStationId: number | undefined;
  /** First active disability slug (fallback for xxx placeholder). */
  firstDisabilitySlug: string | undefined;
};

const SERVICE_SEGMENTS = new Set([
  "keizoku",
  "ikou",
  "type_a",
  "type_b",
  "all",
]);

async function fetchMasterData<T>(endpoint: string): Promise<T[]> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[resolve-output] ${url} → HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { data?: T[] };
    if (!Array.isArray(json.data)) {
      console.warn(`[resolve-output] ${url} → unexpected response shape`);
      return [];
    }
    console.info(`[resolve-output] ${url} → ${json.data.length} items`);
    return json.data;
  } catch (err) {
    console.error(`[resolve-output] ${url} → error:`, err);
    return [];
  }
}

async function fetchFacilitiesPage<T>(endpoint: string): Promise<T[]> {
  const url = `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[resolve-output] ${url} → HTTP ${res.status}`);
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
    console.error(`[resolve-output] ${url} → error:`, err);
    return [];
  }
}

async function loadMasterData(): Promise<MasterData> {
  type SitemapIdResource = { id: number };

  const [
    prefectures,
    searchTags,
    availabilityTypes,
    accessTypes,
    welfareBenefits,
    jobDescriptions,
    industryCategories,
    occupationalCategories,
    wageSalaryTypes,
    disabilities,
    railwayLines,
    sitemapFacilities,
    sitemapCorporations,
    typeAFacilities,
    typeBFacilities,
    typeIFacilities,
  ] = await Promise.all([
    fetchMasterData<PrefectureResource>(
      "/customer/master-data/prefectures?limit=200&with=municipalities",
    ),
    fetchMasterData<SearchTagResource>(
      "/customer/master-data/search-tags?limit=500",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/availability-types?limit=200",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/access-types?limit=200",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/welfare-benefits?limit=200",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/job-descriptions?limit=200",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/industry-categories?limit=200",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/occupational-categories?limit=200",
    ),
    fetchMasterData<NamedMasterResource>(
      "/customer/master-data/wage-salary-types?limit=200",
    ),
    fetchMasterData<DisabilityCategoryResource>(
      "/customer/master-data/disability-categories?limit=200",
    ),
    fetchMasterData<RailwayLineResource>(
      "/customer/master-data/railway-lines?limit=2000&with=stations",
    ),
    fetchMasterData<SitemapIdResource>(
      "/customer/sitemaps/facilities?limit=10",
    ),
    fetchMasterData<SitemapIdResource>(
      "/customer/sitemaps/corporations?limit=5",
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
  ]);

  const prefecturesById = new Map<number, PrefectureResource>();
  const municipalitiesById = new Map<number, MunicipalityResource>();

  for (const pref of prefectures) {
    prefecturesById.set(pref.id, pref);
    for (const muni of pref.municipalities ?? []) {
      municipalitiesById.set(muni.id, muni);
    }
  }

  const stationsById = new Map<number, StationResource>();
  const linesById = new Map<number, RailwayLineResource>();
  let firstStationId: number | undefined;
  for (const line of railwayLines) {
    linesById.set(line.id, line);
    for (const station of line.stations ?? []) {
      stationsById.set(station.id, station);
      if (firstStationId === undefined) firstStationId = station.id;
    }
  }

  const activeDisabilities = disabilities
    .filter((item) => item.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);

  const firstFacilityIds = sitemapFacilities.map((f) => f.id);
  const toFacilityIds = (
    list: { id: number }[],
    fallback: number,
  ): number[] => {
    const ids = list.map((f) => f.id);
    return ids.length > 0 ? ids : [fallback];
  };

  return {
    prefecturesById,
    municipalitiesById,
    searchTagsById: new Map(searchTags.map((item) => [item.id, item])),
    availabilityTypesById: new Map(
      availabilityTypes.map((item) => [item.id, item]),
    ),
    accessTypesById: new Map(accessTypes.map((item) => [item.id, item])),
    welfareBenefitsById: new Map(
      welfareBenefits.map((item) => [item.id, item]),
    ),
    jobDescriptionsById: new Map(
      jobDescriptions.map((item) => [item.id, item]),
    ),
    industryCategoriesById: new Map(
      industryCategories.map((item) => [item.id, item]),
    ),
    occupationalCategoriesById: new Map(
      occupationalCategories.map((item) => [item.id, item]),
    ),
    wageSalaryTypesById: new Map(
      wageSalaryTypes.map((item) => [item.id, item]),
    ),
    disabilitiesBySlug: new Map(
      activeDisabilities.map((item) => [item.slug, item]),
    ),
    defaultSupportedDisabilities: joinActiveDisabilityNames(disabilities),
    linesById,
    stationsById,
    firstFacilityIds,
    facilityIdsByType: {
      type_a: toFacilityIds(typeAFacilities, firstFacilityIds[0] ?? 1),
      type_b: toFacilityIds(typeBFacilities, firstFacilityIds[1] ?? 2),
      type_i: toFacilityIds(typeIFacilities, firstFacilityIds[2] ?? 3),
    },
    firstCorporateId: sitemapCorporations[0]?.id,
    firstStationId,
    firstDisabilitySlug: activeDisabilities[0]?.slug,
  };
}

// Numeric ID used as a placeholder in SEO.csv for facility/corporate pages.
const PLACEHOLDER_ID = 12345;
// Disability slug placeholder used in SEO.csv.
const PLACEHOLDER_DISABILITY_SLUG = "xxx";

/**
 * Replace placeholder segments in a pathname with first real IDs from the API.
 * Returns the canonical pathname and updated fullpath (rooted at NEXT_PUBLIC_BASE_URL).
 */
function canonicalizeEntry(
  entry: OutputEntry,
  pathname: string,
  master: MasterData,
  facilityIndexByType: Record<FacilityServiceType, number>,
): { pathname: string; fullpath: string } {
  const BASE = APP_BASE.replace(/\/+$/, "");
  let canonical = pathname;

  // /rakita/.../xxx/ → first real disability slug
  if (
    (canonical.includes(`/${PLACEHOLDER_DISABILITY_SLUG}/`) ||
      canonical.endsWith(`/${PLACEHOLDER_DISABILITY_SLUG}`)) &&
    master.firstDisabilitySlug
  ) {
    canonical = canonical.replace(
      new RegExp(`/${PLACEHOLDER_DISABILITY_SLUG}(/|$)`, "g"),
      `/${master.firstDisabilitySlug}$1`,
    );
  }

  // /rakita/.../station/<id>/ → first real station when id is missing from master
  const stationMatch = canonical.match(/\/station\/(\d+)\//);
  if (stationMatch) {
    const stationId = Number(stationMatch[1]);
    if (
      !master.stationsById.has(stationId) &&
      master.firstStationId !== undefined
    ) {
      canonical = canonical.replace(
        `/station/${stationId}/`,
        `/station/${master.firstStationId}/`,
      );
    }
  }

  // /rakita/facility/12345/ → real facility ID matching SEO template service type
  if (canonical.includes(`/facility/${PLACEHOLDER_ID}/`)) {
    const serviceType = detectFacilityServiceType(
      entry.titleタグ,
      entry.Description,
      entry.パンくずの表記,
    );
    const pool = master.facilityIdsByType[serviceType];
    const idx = facilityIndexByType[serviceType] % pool.length;
    facilityIndexByType[serviceType]++;
    const realId = pool[idx] ?? master.firstFacilityIds[0];
    if (realId !== undefined) {
      canonical = canonical.replace(
        `/facility/${PLACEHOLDER_ID}/`,
        `/facility/${realId}/`,
      );
    }
  }

  // /rakita/facility_corporate/12345/ → first real corporate
  if (
    canonical.includes(`/facility_corporate/${PLACEHOLDER_ID}/`) &&
    master.firstCorporateId !== undefined
  ) {
    canonical = canonical.replace(
      `/facility_corporate/${PLACEHOLDER_ID}/`,
      `/facility_corporate/${master.firstCorporateId}/`,
    );
  }

  const suffix = canonical.endsWith("/") ? "" : "/";
  const fullpath = `${BASE}${canonical}${suffix}`;
  return { pathname: canonical, fullpath };
}

function scopeToTypeServices(scopeSegments: string[]): string[] {
  if (scopeSegments.length === 0) return [];
  if (scopeSegments.includes("ikou")) return ["type_i"];
  if (scopeSegments.includes("type_a")) return ["type_a"];
  if (scopeSegments.includes("type_b")) return ["type_b"];
  // keizoku/all is still keizoku (type_a + type_b); bare "all" = no type filter
  if (scopeSegments.includes("keizoku")) return ["type_a", "type_b"];
  return [];
}

function parsePath(pathname: string, disabilitySlugs: Set<string>): ParsedPath {
  const segments = pathname.replace(/\/$/, "").split("/").filter(Boolean);
  const parsed: ParsedPath = { tagIds: [] };

  if (segments[0] !== "rakita") return parsed;

  let i = 1;
  const scopeSegments: string[] = [];
  while (i < segments.length && SERVICE_SEGMENTS.has(segments[i]!)) {
    scopeSegments.push(segments[i]!);
    i++;
  }
  parsed.typeServices = scopeToTypeServices(scopeSegments);

  if (segments[i] === "facility") {
    if (/^\d+$/.test(segments[i + 1] ?? "")) {
      parsed.facilityId = Number(segments[i + 1]);
    }
    parsed.isNonListingPage = true;
    return parsed;
  }

  if (segments[i] === "facility_corporate") {
    if (/^\d+$/.test(segments[i + 1] ?? "")) {
      parsed.corporateId = Number(segments[i + 1]);
    }
    parsed.isNonListingPage = true;
    return parsed;
  }

  if (segments[i] === "articles") {
    // Category / tag / article-detail SEO comes from CMS — keep {categoryName}, {seoTitle}, {tag}.
    parsed.isNonListingPage = true;
    return parsed;
  }

  if (i >= segments.length) return parsed;

  if (/^\d+$/.test(segments[i]!)) {
    parsed.prefectureId = Number(segments[i]);
    i++;
  }

  while (i < segments.length) {
    const seg = segments[i]!;

    if (seg === "region") {
      i++;
      if (/^\d+$/.test(segments[i] ?? "")) {
        parsed.regionMunicipalityId = Number(segments[i]);
        i++;
        if (/^\d+$/.test(segments[i] ?? "")) {
          parsed.wardId = Number(segments[i]);
          i++;
        }
      }
      continue;
    }

    if (seg === "station") {
      i++;
      if (/^\d+$/.test(segments[i] ?? "")) {
        parsed.stationId = Number(segments[i]);
        i++;
      }
      continue;
    }

    if (seg === "lines") {
      i++;
      if (/^\d+$/.test(segments[i] ?? "")) {
        parsed.lineId = Number(segments[i]);
        i++;
      }
      continue;
    }

    if (seg === "tag") {
      i++;
      while (/^\d+$/.test(segments[i] ?? "")) {
        parsed.tagIds.push(Number(segments[i]));
        i++;
      }
      continue;
    }

    if (/^\d+$/.test(seg)) {
      if (!parsed.municipalityId && !parsed.regionMunicipalityId) {
        parsed.municipalityId = Number(seg);
      }
      i++;
      continue;
    }

    if (disabilitySlugs.has(seg)) {
      parsed.disabilitySlug = seg;
      i++;
      continue;
    }

    i++;
  }

  return parsed;
}

function findMunicipalityName(
  master: MasterData,
  id: number | undefined,
): string | undefined {
  if (id === undefined) return undefined;
  return master.municipalitiesById.get(id)?.name;
}

function resolveGeo(parsed: ParsedPath, master: MasterData): GeoValues {
  const prefecture = parsed.prefectureId
    ? master.prefecturesById.get(parsed.prefectureId)?.name
    : undefined;

  if (parsed.municipalityId !== undefined) {
    return toGeoValues(
      prefecture,
      findMunicipalityName(master, parsed.municipalityId),
    );
  }

  if (parsed.regionMunicipalityId !== undefined) {
    if (parsed.wardId !== undefined) {
      // Ward pages: skip {city} — ward name already includes the parent city/region.
      return toGeoValues(
        prefecture,
        "",
        findMunicipalityName(master, parsed.wardId),
      );
    }

    return toGeoValues(
      prefecture,
      findMunicipalityName(master, parsed.regionMunicipalityId),
    );
  }

  if (prefecture) return toGeoValues(prefecture);
  return {};
}

function masterNameByTagType(
  master: MasterData,
  tagType: SearchTagType,
  masterId: number,
): string | undefined {
  const lookup = (map: Map<number, NamedMasterResource>): string | undefined =>
    map.get(masterId)?.name ?? undefined;

  switch (tagType) {
    case "availability_type":
      return lookup(master.availabilityTypesById);
    case "access_type":
      return lookup(master.accessTypesById);
    case "welfare_benefit":
      return lookup(master.welfareBenefitsById);
    case "job_description":
      return lookup(master.jobDescriptionsById);
    case "industry_category":
      return lookup(master.industryCategoriesById);
    case "occupational_category":
      return lookup(master.occupationalCategoriesById);
    case "wage_salary_type":
      return lookup(master.wageSalaryTypesById);
    default:
      return undefined;
  }
}

function resolveSearchTagName(
  master: MasterData,
  searchTagId: number,
): string | undefined {
  const searchTag = master.searchTagsById.get(searchTagId);
  if (!searchTag) return undefined;
  return masterNameByTagType(master, searchTag.tag_type, searchTag.master_id);
}

/** Disability names in API response order (matches facility detail page). */
function joinFacilityDisabilityNames(
  categories: DisabilityCategoryResource[] | null | undefined,
): string {
  return (categories ?? [])
    .filter((item) => item.is_active)
    .map((item) => item.name)
    .join("、");
}

/** Active disability category names joined by Japanese comma (master default). */
function joinActiveDisabilityNames(
  categories: DisabilityCategoryResource[] | null | undefined,
): string {
  return (categories ?? [])
    .filter((item) => item.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item) => item.name)
    .join("、");
}

/** Single disability name from path slug (listing pages like /developmental/). */
function resolveDisabilitySlugName(
  master: MasterData,
  slug: string | undefined,
  entryPath: string,
): string | undefined {
  if (!slug) return undefined;
  const category = master.disabilitiesBySlug.get(slug);
  if (!category?.name) {
    console.warn(
      `[resolve-output] disability slug ${slug} not found (${entryPath})`,
    );
    return undefined;
  }
  return category.name;
}

async function fetchCorporateName(
  corporateId: number,
): Promise<string | undefined> {
  const url = `${API_BASE}/customer/corporations/${corporateId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[resolve-output] ${url} → HTTP ${res.status}`);
      return undefined;
    }
    const json = (await res.json()) as {
      data?: { corporation?: { name?: string }; name?: string };
    };
    return json.data?.corporation?.name ?? json.data?.name;
  } catch (err) {
    console.error(`[resolve-output] ${url} → error:`, err);
    return undefined;
  }
}

async function fetchFacilityDetails(
  facilityId: number,
  master: MasterData,
): Promise<FacilityDetails | undefined> {
  const url = `${API_BASE}/customer/facilities/${facilityId}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[resolve-output] ${url} → HTTP ${res.status}`);
      return undefined;
    }
    const json = (await res.json()) as { data?: FacilityResource };
    const facility = json.data;
    if (!facility) return undefined;

    const prefecture = facility.prefecture_id
      ? master.prefecturesById.get(facility.prefecture_id)?.name
      : undefined;
    const city = facility.municipality_id
      ? master.municipalitiesById.get(facility.municipality_id)?.name
      : undefined;

    return toFacilityDetails({
      facilityName: facility.facility_detail?.name,
      companyName: facility.facility_detail?.corporate_name,
      prefecture,
      city,
      supportedDisabilities: joinFacilityDisabilityNames(
        facility.disability_categories,
      ),
    });
  } catch (err) {
    console.error(`[resolve-output] ${url} → error:`, err);
    return undefined;
  }
}

async function fetchFacilityCount(
  pathname: string,
  master: MasterData,
  countCache: Map<string, number>,
): Promise<number | undefined> {
  const disabilitySlugs = new Set(master.disabilitiesBySlug.keys());
  const parsed = parseListingPath(pathname, disabilitySlugs);
  if (parsed.isNonListingPage) return undefined;

  const disabilityIdBySlug = new Map(
    [...master.disabilitiesBySlug.entries()].map(([slug, cat]) => [
      slug,
      cat.id,
    ]),
  );
  const allMunicipalities = [...master.municipalitiesById.values()];
  const lineStationIds =
    parsed.lineId != null
      ? master.linesById.get(parsed.lineId)?.stations?.map((s) => s.id)
      : undefined;
  const params = buildFacilitiesQueryParams(parsed, disabilityIdBySlug, {
    regionWardIds:
      parsed.regionMunicipalityId != null && parsed.wardId == null
        ? wardIdsForRegion(allMunicipalities, parsed.regionMunicipalityId)
        : undefined,
    lineStationIds,
  });
  const cacheKey = params.toString();
  if (countCache.has(cacheKey)) return countCache.get(cacheKey);

  const url = `${API_BASE}/customer/facilities?${cacheKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[resolve-output] count ${url} → HTTP ${res.status}`);
      return undefined;
    }
    const total = readFacilityTotal(await res.json());
    if (total !== undefined) countCache.set(cacheKey, total);
    return total;
  } catch (err) {
    console.error(`[resolve-output] count ${url} → error:`, err);
    return undefined;
  }
}

function buildSlotMap(
  parsed: ParsedPath,
  master: MasterData,
  facility: FacilityDetails | undefined,
  entryPath: string,
): Record<string, string | undefined> {
  const geo = facility
    ? {
        prefecture: facility.prefecture,
        city: facility.city,
        ward: undefined,
      }
    : resolveGeo(parsed, master);

  const slots: Record<string, string | undefined> = {
    prefecture: geo.prefecture,
    city: geo.city,
    ward: geo.ward,
    facilityName: facility?.facilityName,
    companyName: facility?.companyName,
    corporateName: facility?.corporateName,
    supportedDisabilities:
      facility?.supportedDisabilities ?? master.defaultSupportedDisabilities,
    // Listing pages (/developmental/, …): single category name from path slug.
    disability: resolveDisabilitySlugName(
      master,
      parsed.disabilitySlug,
      entryPath,
    ),
  };

  if (parsed.lineId !== undefined) {
    slots.line = master.linesById.get(parsed.lineId)?.name;
    if (!slots.line) {
      console.warn(
        `[resolve-output] line id ${parsed.lineId} not found (${entryPath})`,
      );
    }
  }

  if (parsed.stationId !== undefined) {
    slots.station = master.stationsById.get(parsed.stationId)?.name;
    if (!slots.station) {
      console.warn(
        `[resolve-output] station id ${parsed.stationId} not found (${entryPath})`,
      );
    }
  }

  parsed.tagIds.forEach((tagId, index) => {
    const name = resolveSearchTagName(master, tagId);
    if (!name) {
      console.warn(
        `[resolve-output] search tag id ${tagId} not found (${entryPath})`,
      );
      return;
    }
    if (index === 0) slots.tag = name;
    if (index === 0) slots.tag1 = name;
    if (index === 1) slots.tag2 = name;
  });

  return slots;
}

type AppPageSeo = {
  title: string;
  description: string;
  h1: string;
  breadcrumb: string;
};

function isArticlePageNeedingLiveSeo(pathname: string): boolean {
  if (!pathname.startsWith("/rakita/articles")) return false;
  return pathname !== "/rakita/articles" && pathname !== "/rakita/articles/";
}

async function fetchAppPageSeo(
  pathname: string,
): Promise<AppPageSeo | undefined> {
  const suffix = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const url = `${APP_BASE}${suffix}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[resolve-output] ${url} → HTTP ${res.status}`);
      return undefined;
    }
    const html = await res.text();
    const $ = cheerio.load(html);
    const segments = $(
      '[data-testid="breadcrum-list"] [data-slot="breadcrumb-link"], [data-testid="breadcrum-list"] [data-slot="breadcrumb-page"]',
    )
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((text) => text.length > 0);

    return {
      title: $("title").text().trim(),
      description: $('meta[name="description"]').attr("content")?.trim() ?? "",
      h1:
        $('[data-testid="facility-result-location"]').first().text().trim() ||
        $("h1").first().text().trim(),
      breadcrumb: segments.join(">"),
    };
  } catch (err) {
    console.warn(`[resolve-output] ${url} → ${(err as Error).message}`);
    return undefined;
  }
}

function substituteSlots(
  template: string,
  slots: Record<string, string | undefined>,
  entryPath: string,
): string {
  return template.replace(/\{([^{}]+)\}/g, (match, slotName: string) => {
    const value = slots[slotName];
    if (value === undefined) {
      console.warn(
        `[resolve-output] unresolved slot {${slotName}} (${entryPath})`,
      );
    }
    return value ?? match;
  });
}

function resolveFields(
  fields: NormalizedFields,
  slots: Record<string, string | undefined>,
  entryPath: string,
): NormalizedFields {
  const resolved: NormalizedFields = {
    fullpath: fields.fullpath,
    title: substituteSlots(fields.title, slots, entryPath),
    description: substituteSlots(fields.description, slots, entryPath),
  };

  if (fields.h1) resolved.h1 = substituteSlots(fields.h1, slots, entryPath);
  if (fields.breadcrumb) {
    resolved.breadcrumb = substituteSlots(fields.breadcrumb, slots, entryPath);
  }

  return resolved;
}

async function run(): Promise<void> {
  console.info(`[resolve-output] BASE_API_URL=${API_BASE}`);

  const raw = fs.readFileSync(INPUT_FILE, "utf-8");
  const rawEntries = JSON.parse(raw) as OutputEntry[];
  const entries = rawEntries.map((entry, index) => {
    try {
      return normalizeItem(entry) as OutputEntry;
    } catch (err) {
      console.error(`\n[normalize] Error at index ${index}`);
      console.error(`Path: ${entry.path}`);
      console.error(`Fullpath: ${entry.fullpath}`);
      throw err;
    }
  });
  const master = await loadMasterData();

  if (master.prefecturesById.size === 0) {
    throw new Error(
      `No prefecture data returned from ${API_BASE}. Set BASE_API_URL and ensure the API is running.`,
    );
  }

  const facilityCache = new Map<number, FacilityDetails | undefined>();
  const corporateNameCache = new Map<number, string | undefined>();
  const countCache = new Map<string, number>();
  const disabilitySlugs = new Set(master.disabilitiesBySlug.keys());
  const facilityIndexByType: Record<FacilityServiceType, number> = {
    type_a: 0,
    type_b: 0,
    type_i: 0,
  };
  const result: OutputEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const rawEntry = rawEntries[i]!;
    const rawPathname =
      entry.path ||
      (() => {
        try {
          return new URL(entry.fullpath).pathname;
        } catch {
          return "";
        }
      })();
    const { pathname: entryPath, fullpath: canonicalFullpath } =
      canonicalizeEntry(entry, rawPathname, master, facilityIndexByType);
    const canonEntry: OutputEntry = {
      ...entry,
      fullpath: canonicalFullpath,
      path: entryPath,
    };
    const parsed = parsePath(entryPath, disabilitySlugs);

    let facility: FacilityDetails | undefined;
    if (parsed.facilityId !== undefined) {
      if (!facilityCache.has(parsed.facilityId)) {
        facilityCache.set(
          parsed.facilityId,
          await fetchFacilityDetails(parsed.facilityId, master),
        );
      }
      facility = facilityCache.get(parsed.facilityId);
    }

    if (parsed.corporateId !== undefined) {
      if (!corporateNameCache.has(parsed.corporateId)) {
        corporateNameCache.set(
          parsed.corporateId,
          await fetchCorporateName(parsed.corporateId),
        );
      }
      const corporateName = corporateNameCache.get(parsed.corporateId);
      if (corporateName !== undefined) {
        facility = toFacilityDetails({ ...facility, corporateName });
      }
    }

    const slots = buildSlotMap(parsed, master, facility, entryPath);
    const count = await fetchFacilityCount(entryPath, master, countCache);
    if (count !== undefined) slots.count = String(count);
    let resolved = resolveFields(entryToFields(canonEntry), slots, entryPath);

    if (isArticlePageNeedingLiveSeo(entryPath)) {
      const live = await fetchAppPageSeo(entryPath);
      if (live) {
        resolved = {
          ...resolved,
          title: live.title,
          description: live.description,
          h1: live.h1,
          breadcrumb: live.breadcrumb,
        };
      }
    }

    if (!isArticlePageNeedingLiveSeo(entryPath)) {
      assertResolvedTitleParenStyle(
        rawEntry.titleタグ,
        resolved.title,
        entryPath,
      );
    }

    result.push(applyResolvedFields(canonEntry, resolved));
  }

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
