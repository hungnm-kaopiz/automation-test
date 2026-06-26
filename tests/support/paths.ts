export function getPathname(value: string): string {
  return new URL(value).pathname;
}

export function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function pathnamesMatch(actual: string, expected: string): boolean {
  return normalizePathname(actual) === normalizePathname(expected);
}

const RAKITA_SCOPE_SEGMENTS = new Set([
  "keizoku",
  "ikou",
  "type_a",
  "type_b",
  "all",
]);

/** True for /rakita/ listing paths without service-scope prefixes. */
export function isRootRakitaPath(path: string): boolean {
  const segments = normalizePathname(path).split("/").filter(Boolean);
  return segments[0] === "rakita" && !RAKITA_SCOPE_SEGMENTS.has(segments[1] ?? "");
}
