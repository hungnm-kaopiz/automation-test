/**
 * Extract toàn bộ URL từ sitemap index (fetch đệ quy các sitemap con),
 * lưu ra JSON group theo tên sitemap (top, facility-list, facility-detail, ...).
 *
 * Usage: node --env-file=.env --experimental-strip-types extract-sitemap-urls.ts
 */
import { writeFile } from "node:fs/promises";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;
if (!BASE_URL) throw new Error("Missing env NEXT_PUBLIC_BASE_URL");

const INDEX_URL = `${BASE_URL}/sitemap.xml`;
const OUTPUT_FILE = "sitemap-urls.json";
const CONCURRENCY = 8;
const RETRIES = 3;

const LOC_RE = /<loc>\s*(.*?)\s*<\/loc>/gs;

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "sitemap-extractor" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= RETRIES) throw e;
      console.error(`  retry ${attempt}/${RETRIES} ${url}: ${e}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((m) => m[1]);
}

/** "https://…/sitemaps/facility-list-12.xml" -> "facility-list" */
function sitemapName(sitemapUrl: string): string {
  const file = new URL(sitemapUrl).pathname.split("/").at(-1) ?? sitemapUrl;
  return file.replace(/-\d+\.xml$/, "").replace(/\.xml$/, "");
}

/** Chạy tasks với giới hạn số lượng đồng thời, giữ nguyên thứ tự kết quả. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

console.log(`Fetching index: ${INDEX_URL}`);
const childSitemaps = extractLocs(await fetchText(INDEX_URL));
console.log(`Found ${childSitemaps.length} child sitemaps\n`);

const results = await mapLimit(
  childSitemaps,
  CONCURRENCY,
  async (sitemapUrl) => {
    const urls = extractLocs(await fetchText(sitemapUrl));
    console.log(`  ${sitemapUrl} -> ${urls.length} urls`);
    return { name: sitemapName(sitemapUrl), urls };
  },
);

const grouped: Record<string, string[]> = {};
for (const { name, urls } of results) {
  (grouped[name] ??= []).push(...urls);
}

await writeFile(OUTPUT_FILE, JSON.stringify(grouped, null, 2));

const total = Object.values(grouped).reduce((n, urls) => n + urls.length, 0);
console.log(`\nTotal: ${total} urls -> ${OUTPUT_FILE}`);
for (const [name, urls] of Object.entries(grouped)) {
  console.log(`  ${name}: ${urls.length}`);
}
