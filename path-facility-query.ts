/**
 * Map rakita listing URL paths → GET /customer/facilities query params.
 * Shared by generate-test-paths.ts (validation) and resolve-output-slots.ts ({count}).
 */

export const SERVICE_SEGMENTS = new Set([
  "keizoku",
  "ikou",
  "type_a",
  "type_b",
  "all",
]);

export type ParsedListingPath = {
  prefectureId?: number;
  municipalityId?: number;
  regionMunicipalityId?: number;
  wardId?: number;
  stationId?: number;
  lineId?: number;
  tagIds: number[];
  disabilitySlug?: string;
  typeServices?: string[];
  isNonListingPage?: boolean;
};

export function isRegionOnlyListing(parsed: ParsedListingPath): boolean {
  return parsed.regionMunicipalityId != null && parsed.wardId == null;
}

export function wardIdsForRegion(
  municipalities: Iterable<{ id: number; parent_id?: number | null }>,
  regionMunicipalityId: number,
): number[] {
  return [...municipalities]
    .filter((m) => m.parent_id === regionMunicipalityId)
    .map((m) => m.id);
}

export function scopeToTypeServices(scopeSegments: string[]): string[] {
  if (scopeSegments.length === 0) return [];
  if (scopeSegments.includes("ikou")) return ["type_i"];
  if (scopeSegments.includes("type_a")) return ["type_a"];
  if (scopeSegments.includes("type_b")) return ["type_b"];
  if (scopeSegments.includes("keizoku")) return ["type_a", "type_b"];
  return [];
}

export function parseListingPath(
  pathname: string,
  disabilitySlugs: Set<string>,
): ParsedListingPath {
  const segments = pathname.replace(/\/$/, "").split("/").filter(Boolean);
  const parsed: ParsedListingPath = { tagIds: [] };

  if (segments[0] !== "rakita") return parsed;

  let i = 1;
  const scopeSegments: string[] = [];
  while (i < segments.length && SERVICE_SEGMENTS.has(segments[i]!)) {
    scopeSegments.push(segments[i]!);
    i++;
  }
  parsed.typeServices = scopeToTypeServices(scopeSegments);

  if (segments[i] === "facility") {
    parsed.isNonListingPage = true;
    return parsed;
  }

  if (segments[i] === "facility_corporate") {
    parsed.isNonListingPage = true;
    return parsed;
  }

  if (segments[i] === "articles") {
    parsed.isNonListingPage = true;
    return parsed;
  }

  if (segments[i] === "facility_brands") {
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

export type FacilitiesQueryContext = {
  /** Ward municipality ids aggregated for /region/{parent}/ listing pages. */
  regionWardIds?: number[] | undefined;
  /** All station ids on a railway line for /lines/{id}/ listing pages. */
  lineStationIds?: number[] | undefined;
};

export function buildFacilitiesQueryParams(
  parsed: ParsedListingPath,
  disabilityIdBySlug: Map<string, number>,
  context: FacilitiesQueryContext = {},
): URLSearchParams {
  const params = new URLSearchParams({ limit: "1" });

  if (parsed.prefectureId !== undefined) {
    params.append("prefecture_ids[]", String(parsed.prefectureId));
  }

  if (parsed.wardId != null) {
    params.append("municipality_ids[]", String(parsed.wardId));
  } else if (
    isRegionOnlyListing(parsed) &&
    context.regionWardIds != null &&
    context.regionWardIds.length > 0
  ) {
    for (const wardId of context.regionWardIds) {
      params.append("municipality_ids[]", String(wardId));
    }
  } else if (parsed.regionMunicipalityId != null) {
    params.append("municipality_ids[]", String(parsed.regionMunicipalityId));
  } else if (parsed.municipalityId != null) {
    params.append("municipality_ids[]", String(parsed.municipalityId));
  }

  if (
    parsed.lineId != null &&
    context.lineStationIds != null &&
    context.lineStationIds.length > 0
  ) {
    for (const stationId of context.lineStationIds) {
      params.append("facility_stations_station_ids[]", String(stationId));
    }
  } else if (parsed.stationId !== undefined) {
    params.append("facility_stations_station_ids[]", String(parsed.stationId));
  }

  for (const tagId of parsed.tagIds) {
    params.append("tag_ids[]", String(tagId));
  }

  if (parsed.disabilitySlug !== undefined) {
    const disabilityId = disabilityIdBySlug.get(parsed.disabilitySlug);
    if (disabilityId !== undefined) {
      params.append(
        "facility_disability_categories_ids[]",
        String(disabilityId),
      );
    }
  }

  for (const ts of parsed.typeServices ?? []) {
    params.append("type_services[]", ts);
  }

  return params;
}

/** Read meta.total from either paginator shape the API may return. */
export function readFacilityTotal(json: unknown): number | undefined {
  const body = json as {
    meta?: { total?: number };
    data?: { meta?: { total?: number } } | unknown[];
  };
  if (typeof body.meta?.total === "number") return body.meta.total;
  if (
    body.data &&
    typeof body.data === "object" &&
    !Array.isArray(body.data) &&
    typeof (body.data as { meta?: { total?: number } }).meta?.total ===
      "number"
  ) {
    return (body.data as { meta: { total: number } }).meta.total;
  }
  return undefined;
}

export type FacilityServiceType = "type_a" | "type_b" | "type_i";

/** Infer facility detail page service type from SEO template text. */
export function detectFacilityServiceType(
  ...fields: (string | null | undefined)[]
): FacilityServiceType {
  const text = fields.filter(Boolean).join(" ");
  if (text.includes("就労継続支援B型")) return "type_b";
  if (text.includes("就労移行支援")) return "type_i";
  return "type_a";
}
