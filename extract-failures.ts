/**
 * Extract failed Playwright cases back into JSON rows for re-runs.
 *
 * Reads Playwright state from (in order):
 *   1. test-results/results.json  — JSON reporter output
 *   2. test-results/.../error-context.md — leftover folders from the last run
 *
 * Matches test titles like:
 *   [output.final.json] 4 /rakita/1/region/2/
 *
 * Usage:
 *   npm run test:metadata
 *   npm run extract:failures
 *
 * Env:
 *   SOURCE_FILE  — input JSON (default: output.final.json)
 *   REPORT_FILE  — Playwright JSON report (default: test-results/results.json)
 *   OUTPUT_FILE  — failures output (default: output.failed.json)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type OutputEntry = {
  fullpath: string;
  path?: string;
  [key: string]: unknown;
};

type FailedCase = {
  sourceFile: string;
  index: number;
  label: string;
  error?: string;
};

type JsonReportSpec = {
  title?: string;
  tests?: Array<{
    results?: Array<{ status?: string; error?: { message?: string } }>;
  }>;
};

type JsonReportSuite = {
  title?: string;
  specs?: JsonReportSpec[];
  suites?: JsonReportSuite[];
};

type JsonReport = {
  suites?: JsonReportSuite[];
};

const SOURCE_FILE = process.env["SOURCE_FILE"] ?? "output.final.json";
const REPORT_FILE =
  process.env["REPORT_FILE"] ?? "test-results/results.json";
const OUTPUT_FILE = process.env["OUTPUT_FILE"] ?? "output.failed.json";

const TEST_TITLE_RE = /^\[([^\]]+)\]\s+(\d+)\s+(.+)$/;

function parseTestTitle(title: string): FailedCase | null {
  const trimmed = title.trim();
  const match = trimmed.match(TEST_TITLE_RE);
  if (!match) return null;

  return {
    sourceFile: match[1]!,
    index: Number.parseInt(match[2]!, 10),
    label: match[3]!,
  };
}

function parseFullTestName(fullName: string): FailedCase | null {
  const parts = fullName.split(">>").map((part) => part.trim());
  const leaf = parts.at(-1);
  if (!leaf) return null;
  return parseTestTitle(leaf);
}

function isFailedResult(status: string | undefined): boolean {
  return status === "failed" || status === "timedOut" || status === "interrupted";
}

function collectFromJsonReport(report: JsonReport): FailedCase[] {
  const failures: FailedCase[] = [];

  const walkSuite = (suite: JsonReportSuite): void => {
    for (const spec of suite.specs ?? []) {
      const parsed = parseTestTitle(spec.title ?? "");
      if (!parsed) continue;

      const failedResult = spec.tests
        ?.flatMap((test) => test.results ?? [])
        .find((result) => isFailedResult(result.status));

      if (!failedResult) continue;

      failures.push({
        ...parsed,
        error: failedResult.error?.message,
      });
    }

    for (const child of suite.suites ?? []) {
      walkSuite(child);
    }
  };

  for (const suite of report.suites ?? []) {
    walkSuite(suite);
  }

  return failures;
}

function readJsonReport(reportPath: string): FailedCase[] {
  if (!fs.existsSync(reportPath)) return [];

  const report = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as JsonReport;
  return collectFromJsonReport(report);
}

function collectFromErrorContexts(testResultsDir: string): FailedCase[] {
  if (!fs.existsSync(testResultsDir)) return [];

  const failures: FailedCase[] = [];

  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.name !== "error-context.md") continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      const nameMatch = content.match(/^- Name:\s+(.+)$/m);
      if (!nameMatch) continue;

      const parsed = parseFullTestName(nameMatch[1]!);
      if (!parsed) continue;

      const errorMatch = content.match(
        /# Error details\s+```\s*([\s\S]*?)```/,
      );

      failures.push({
        ...parsed,
        error: errorMatch?.[1]?.trim(),
      });
    }
  };

  walk(testResultsDir);
  return failures;
}

function dedupeFailures(failures: FailedCase[]): FailedCase[] {
  const byKey = new Map<string, FailedCase>();

  for (const failure of failures) {
    const key = `${failure.sourceFile}#${failure.index}`;
    if (!byKey.has(key)) {
      byKey.set(key, failure);
    }
  }

  return [...byKey.values()].sort((a, b) => a.index - b.index);
}

function run(): void {
  const sourcePath = path.resolve(__dirname, SOURCE_FILE);
  const reportPath = path.resolve(__dirname, REPORT_FILE);
  const outputPath = path.resolve(__dirname, OUTPUT_FILE);
  const testResultsDir = path.resolve(__dirname, "test-results");

  const entries = JSON.parse(fs.readFileSync(sourcePath, "utf-8")) as OutputEntry[];

  const fromReport = readJsonReport(reportPath);
  const fromFolders = collectFromErrorContexts(testResultsDir);
  const failures = dedupeFailures([...fromReport, ...fromFolders]);

  if (failures.length === 0) {
    console.log("✅ No failed Playwright cases found.");
    console.log(`   Checked: ${reportPath}`);
    console.log(`   Checked: ${testResultsDir} (error-context.md)`);
    fs.writeFileSync(outputPath, "[]\n", "utf-8");
    console.log(`   Wrote empty → ${outputPath}`);
    return;
  }

  const sourceMismatch = failures.filter((f) => f.sourceFile !== SOURCE_FILE);
  if (sourceMismatch.length > 0) {
    console.warn(
      `⚠️  ${sourceMismatch.length} failure(s) belong to a different SOURCE_FILE than ${SOURCE_FILE}`,
    );
  }

  const relevant = failures.filter((f) => f.sourceFile === SOURCE_FILE);
  const failedEntries = relevant.flatMap((failure) => {
    const entry = entries[failure.index - 1];
    if (!entry) {
      console.warn(
        `⚠️  Missing entry at index ${failure.index} (${failure.label}) in ${SOURCE_FILE}`,
      );
      return [];
    }

    return [
      {
        ...entry,
        _failure: {
          index: failure.index,
          label: failure.label,
          error: failure.error ?? null,
        },
      },
    ];
  });

  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(failedEntries, null, 2)}\n`,
    "utf-8",
  );

  console.log(
    `❌ Extracted ${failedEntries.length} failed entries → ${outputPath}`,
  );
  console.log(`   Source: ${fromReport.length} from JSON report, ${fromFolders.length} from test-results/`);
}

run();
