import { normalizePathname } from "./paths.js";

export function buildSearchPath(params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `/rakita/facility?${query.toString()}`;
}

export function pathToSearchParams(targetPath: string): Record<string, string> {
  const segments = normalizePathname(targetPath).split("/").filter(Boolean);

  if (segments[0] !== "rakita") {
    throw new Error(`Unsupported redirect path: ${targetPath}`);
  }

  const prefectureId = segments[1];
  if (!prefectureId) {
    throw new Error(`Missing prefecture id in path: ${targetPath}`);
  }

  const rest = segments.slice(2);
  if (rest.length === 0) {
    return { prefectureId };
  }

  if (rest[0] === "region") {
    const regionId = rest[1];
    const wardId = rest[2];

    if (wardId) {
      return { prefectureId, wardIds: wardId };
    }
    if (regionId) {
      return { prefectureId, regionIds: regionId };
    }
    throw new Error(`Incomplete region path: ${targetPath}`);
  }

  const municipalityId = rest[0];
  if (!municipalityId) {
    throw new Error(`Missing municipality id in path: ${targetPath}`);
  }

  return { prefectureId, municipalityIds: municipalityId };
}
