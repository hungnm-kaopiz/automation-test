# AGENT.md

## Project Overview

This repository contains a Playwright contract-test suite for the Rakita site under `http://localhost:3000/rakita`.

The main goal is to verify that live pages match the SEO metadata contract defined in `metadata.csv`, and that the route inventory in `ROUTES.md` stays aligned with the pages under test.

## Important Files

- [tests/metadata.spec.ts](tests/metadata.spec.ts) - main data-driven Playwright suite.
- [metadata.csv](metadata.csv) - source of truth for expected title, description, breadcrumb, and H1 values.
- [ROUTES.md](ROUTES.md) - route inventory and page classification reference.
- [package.json](package.json) - scripts and test entrypoints.
- [playwright.config.ts](playwright.config.ts) - Playwright config, including `baseURL` and reporter settings.

## How The Suite Works

- Each scenario in `tests/metadata.spec.ts` maps a route path to a metadata row via `rowMatcher`.
- The test loads the page with `page.goto(path, { waitUntil: "domcontentloaded" })`.
- It asserts title, description, breadcrumb, and optionally H1.
- Breadcrumb output in the HTML report is formatted as `x > y > z` for readability.
- Breadcrumb assertions still compare against the raw page text after normalization.

## When Adding A New Page

1. Add or confirm the route in `ROUTES.md` if it is a new route or if you want the inventory updated.
2. Add a row in `metadata.csv` with the expected SEO values.
3. Add a new scenario in `tests/metadata.spec.ts` with:
   - `name`
   - `path`
   - `rowMatcher`
   - `assertH1` if the page should have one
   - `skip` if a field should not be checked
4. Run `pnpm exec playwright test --project=chromium --reporter=line`.

## Testing Rules

- Prefer small, data-driven changes over hard-coded page-specific logic.
- Keep breadcrumb handling simple. Use normalization instead of brittle DOM assumptions.
- Use `skip.breadcrumb` only for pages that truly do not have breadcrumbs, such as the TOP page.
- Only assert H1 on pages where the site contract expects it, currently the SEO listing pages.

## Output And Debugging

- The suite attaches a `page-output` markdown snapshot to each test run.
- Use the Playwright HTML report when you need to inspect actual vs expected values.
- If a page is SSR-heavy or slow, keep `domcontentloaded` unless there is a concrete reason to wait longer.

## Style Notes For Future Agents

- Make the smallest change that solves the contract mismatch.
- Do not refactor the suite into a different architecture unless the user asks for it.
- Preserve the existing scenario structure and CSV-driven contract model.
