/**
 * Reverse-check listing URLs against GET /customer/facilities via the orval client.
 *
 * For each URL in SOURCE_FILE, parse the rakita path segments
 * (prefecture / municipality / station / lines / tag / disability / service scope),
 * bind them into V1CustomerFacilitiesIndexParams, call v1CustomerFacilitiesIndex
 * and report meta.total — so a not-found page can be classified as either
 * "API really has 0 facilities" (bad sitemap URL) or "API has data" (FE bug).
 *
 * Usage:
 *   node --env-file=.env --experimental-strip-types verify-failed-urls-api.ts
 *
 * Env:
 *   BASE_API_URL — API origin incl. /api/v1 (default: http://localhost:8080/api/v1)
 *   SOURCE_FILE  — grouped {group: [urls]} or flat [urls] JSON (default: sitemap-urls.failed.json)
 *   OUTPUT_FILE  — per-URL results (default: sitemap-failures.api-check.json)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildFacilitiesQueryParams,
  isRegionOnlyListing,
  parseListingPath,
  readFacilityTotal,
  wardIdsForRegion,
  type FacilitiesQueryContext,
} from "./path-facility-query.ts";
import {
  v1CustomerFacilitiesIndex,
  v1CustomerMasterDataDisabilityCategoriesIndex,
  v1CustomerMasterDataPrefecturesIndex,
  v1CustomerMasterDataRailwayLinesIndex,
  type V1CustomerFacilitiesIndexParams,
} from "./src/api/orval.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_BASE = process.env["BASE_API_URL"] ?? "http://localhost:8080/api/v1";
const SOURCE_FILE = process.env["SOURCE_FILE"] ?? "sitemap-urls.json";
const OUTPUT_FILE =
  process.env["OUTPUT_FILE"] ?? "sitemap-failures.api-check.json";
const CONCURRENCY = Number(process.env["CONCURRENCY"] ?? "5");

/**
 * The orval fetch client requests relative paths ("/customer/facilities?…")
 * and serializes array params as "a,b". Wrap global fetch to prefix the API
 * base and re-expand comma-joined "key[]" values into repeated params.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  let url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  if (url.startsWith("/")) {
    const [pathname, query = ""] = url.split("?");
    const expanded = new URLSearchParams();
    for (const [key, value] of new URLSearchParams(query)) {
      if (key.endsWith("[]") && value.includes(",")) {
        for (const part of value.split(",")) expanded.append(key, part);
      } else {
        expanded.append(key, value);
      }
    }
    const qs = expanded.toString();
    url = `${API_BASE}${pathname}${qs ? `?${qs}` : ""}`;
  }

  return realFetch(url, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
}) as typeof fetch;

function loadUrls(sourcePath: string): { group: string; url: string }[] {
  const raw = JSON.parse(fs.readFileSync(sourcePath, "utf-8")) as
    | Record<string, string[]>
    | string[];

  if (Array.isArray(raw)) {
    return raw.map((url) => ({ group: "default", url }));
  }
  return Object.entries(raw).flatMap(([group, urls]) =>
    urls.map((url) => ({ group, url })),
  );
}

/** Convert the shared URLSearchParams builder output into typed orval params. */
function toOrvalParams(
  searchParams: URLSearchParams,
): V1CustomerFacilitiesIndexParams {
  const params: Record<string, unknown> = {};
  for (const [key, value] of searchParams) {
    if (key.endsWith("[]")) {
      const list = (params[key] as unknown[] | undefined) ?? [];
      list.push(key === "type_services[]" ? value : Number(value));
      params[key] = list;
    } else if (key === "limit" || key === "page") {
      params[key] = Number(value);
    } else {
      params[key] = value;
    }
  }
  return params as V1CustomerFacilitiesIndexParams;
}

async function loadDisabilitySlugMap(): Promise<Map<string, number>> {
  const res = await v1CustomerMasterDataDisabilityCategoriesIndex({
    limit: 100,
  });
  if (res.status !== 200) return new Map();
  const items = res.data.data as unknown as { id: number; slug?: string }[];
  return new Map(items.filter((d) => d.slug).map((d) => [d.slug!, d.id]));
}

async function loadLineStationIds(): Promise<Map<number, number[]>> {
  const res = await v1CustomerMasterDataRailwayLinesIndex({
    limit: 2000,
    with: "stations",
  });
  if (res.status !== 200) return new Map();
  const lines = res.data.data as unknown as {
    id: number;
    stations?: { id: number }[];
  }[];
  return new Map(
    lines.map((line) => [line.id, (line.stations ?? []).map((s) => s.id)]),
  );
}

type Municipality = { id: number; parent_id?: number | null };

async function loadMunicipalities(): Promise<Municipality[]> {
  const res = await v1CustomerMasterDataPrefecturesIndex({
    limit: 50,
    with: "municipalities",
  });
  if (res.status !== 200) return [];
  const prefectures = res.data.data as unknown as {
    municipalities?: Municipality[];
  }[];
  return prefectures.flatMap((p) => p.municipalities ?? []);
}

type CheckResult = {
  group: string;
  url: string;
  apiUrl: string;
  query: string;
  status: number;
  total: number | null;
  verdict: "HAS_DATA" | "EMPTY" | "SKIPPED" | "API_ERROR";
};

async function run(): Promise<void> {
  const sourcePath = path.resolve(__dirname, SOURCE_FILE);
  const outputPath = path.resolve(__dirname, OUTPUT_FILE);

  const entries = loadUrls(sourcePath);
  console.log(
    `Checking ${entries.length} URLs from ${SOURCE_FILE} against ${API_BASE}`,
  );

  const disabilityIdBySlug = await loadDisabilitySlugMap();
  const disabilitySlugs = new Set(disabilityIdBySlug.keys());
  const needsLines = entries.some(({ url }) =>
    new URL(url).pathname.includes("/lines/"),
  );
  const lineStationIdsByLineId = needsLines
    ? await loadLineStationIds()
    : new Map<number, number[]>();
  const needsRegions = entries.some(({ url }) =>
    new URL(url).pathname.includes("/region/"),
  );
  const municipalities = needsRegions ? await loadMunicipalities() : [];

  const results: CheckResult[] = new Array(entries.length);

  const checkOne = async ({
    group,
    url,
  }: {
    group: string;
    url: string;
  }): Promise<CheckResult> => {
    const pathname = new URL(url).pathname;
    const parsed = parseListingPath(pathname, disabilitySlugs);

    if (parsed.isNonListingPage) {
      console.log(`⏭️  SKIPPED (not a listing page) ${url}`);
      return {
        group,
        url,
        apiUrl: "",
        query: "",
        status: 0,
        total: null,
        verdict: "SKIPPED",
      };
    }

    const context: FacilitiesQueryContext = {
      lineStationIds:
        parsed.lineId != null
          ? lineStationIdsByLineId.get(parsed.lineId)
          : undefined,
      regionWardIds: isRegionOnlyListing(parsed)
        ? wardIdsForRegion(municipalities, parsed.regionMunicipalityId!)
        : undefined,
    };

    const searchParams = buildFacilitiesQueryParams(
      parsed,
      disabilityIdBySlug,
      context,
    );
    const orvalParams = toOrvalParams(searchParams);
    const apiUrl = `${API_BASE}/customer/facilities?${searchParams.toString()}`;
    const res = await v1CustomerFacilitiesIndex(orvalParams);

    const total =
      res.status === 200 ? (readFacilityTotal(res.data) ?? null) : null;
    const verdict: CheckResult["verdict"] =
      res.status !== 200
        ? "API_ERROR"
        : total !== null && total > 0
          ? "HAS_DATA"
          : "EMPTY";

    const icon =
      verdict === "HAS_DATA" ? "✅" : verdict === "EMPTY" ? "🈳" : "❓";
    console.log(
      `${icon} total=${String(total).padStart(5)} status=${res.status} ${url}\n   → GET ${apiUrl}`,
    );

    return {
      group,
      url,
      apiUrl,
      query: searchParams.toString(),
      status: res.status,
      total,
      verdict,
    };
  };

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, entries.length) },
    async () => {
      while (cursor < entries.length) {
        const index = cursor++;
        results[index] = await checkOne(entries[index]!);
      }
    },
  );
  await Promise.all(workers);

  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(results, null, 2)}\n`,
    "utf-8",
  );

  const byVerdict = new Map<string, number>();
  for (const r of results)
    byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1);

  console.log(`\nSummary (${results.length} URLs) → ${outputPath}`);
  for (const [verdict, count] of byVerdict)
    console.log(`  ${verdict}: ${count}`);
}

await run();
