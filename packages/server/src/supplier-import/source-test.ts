import { ROBOTS_MAX_BYTES, interpretRobotsResponse, robotsAllows } from './robots.js';
import type { HttpClient } from './http-client.js';
import {
  SourceReadError,
  asSourceError,
  createStoreApiAdapter,
  type FailureStatus,
  type RecordProblem,
  type SourceFailureCode,
  type SourceProductRecord,
} from './woocommerce-store.js';

/**
 * Phase 9 P9-3: "Test Source". Reads robots.txt and ONE page of at most `SAMPLE_SIZE` products of the source (2 requests), judges the
 * sample, and returns what the screen shows so a person can confirm the sample is right. It writes nothing and creates no record,
 * candidate or image. A source becomes READY only when a person confirms a passed test (design section 3).
 */

/** Owner, 2026-10-10: live fetching is limited to a 20-product sample until the process is proven. */
export const SAMPLE_SIZE = 20;

/** The pass thresholds of the sample (share of the sampled products). Missing SKUs never fail a test (HARU-<id> fills in). */
export const PASS_RULES = Object.freeze({
  minUsableShare: 0.9,
  minPriceShare: 0.5,
  minImageShare: 0.5,
});

export interface SampleEntry {
  key: string;
  name: string;
  sku: string | null;
  url: string;
  type: string;
  brandText: string | null;
  categoryNames: string[];
  /** Reference only; the API removes both for callers without MANAGE_PRODUCT_PRICES. */
  priceVnd: number | null;
  promoPriceVnd: number | null;
  currency: string;
  imageCount: number;
  firstImageUrl: string | null;
  descriptionLength: number;
  variationCount: number;
  problems: string[];
}

export interface TestProblemGroup {
  code: string;
  count: number;
  /** A few product ids as examples. */
  keys: string[];
}

export interface SourceTestSummary {
  /** `X-WP-Total`: the number of products the site says it has. */
  total: number | null;
  sampled: number;
  usable: number;
  withSku: number;
  withPrice: number;
  withImages: number;
  withCategory: number;
  withDescription: number;
  robots: 'ALLOWED' | 'NO_FILE';
  crawlDelaySeconds: number | null;
}

export type SourceTestResult =
  | {
      outcome: 'PASSED';
      summary: SourceTestSummary;
      sample: SampleEntry[];
      problems: TestProblemGroup[];
      requests: number;
    }
  | {
      outcome: 'FAILED';
      failure: {
        code: SourceFailureCode | 'TOO_FEW_USABLE' | 'TOO_FEW_PRICES' | 'TOO_FEW_IMAGES' | 'EMPTY';
        status: FailureStatus;
        detail?: string;
      };
      summary: SourceTestSummary | null;
      sample: SampleEntry[];
      problems: TestProblemGroup[];
      requests: number;
    };

function entry(record: SourceProductRecord, problems: RecordProblem[]): SampleEntry {
  return {
    key: record.sourceKey,
    name: record.name,
    sku: record.sku,
    url: record.url,
    type: record.type,
    brandText: record.brandText,
    categoryNames: record.categoryNames,
    priceVnd: record.priceVnd,
    promoPriceVnd: record.promoPriceVnd,
    currency: record.currency,
    imageCount: record.images.length,
    firstImageUrl: record.images[0]?.url ?? null,
    descriptionLength: (record.descriptionText ?? record.shortDescriptionText ?? '').length,
    variationCount: record.variations.length,
    problems: problems.map((problem) => problem.code),
  };
}

function groupProblems(
  all: { key: string | null; problems: RecordProblem[] }[],
): TestProblemGroup[] {
  const groups = new Map<string, TestProblemGroup>();
  for (const item of all) {
    for (const problem of item.problems) {
      const group = groups.get(problem.code) ?? { code: problem.code, count: 0, keys: [] };
      group.count += 1;
      if (item.key !== null && group.keys.length < 5) group.keys.push(item.key);
      groups.set(problem.code, group);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * robots.txt of the source's host, read before any other request: a missing file allows, an unreadable one or a Disallow for the
 * products path stops everything (SourceReadError). A Crawl-delay slows the client down. Shared by Test Source and the scan.
 */
export async function checkRobots(
  client: HttpClient,
  baseUrl: string,
  pageSize: number,
): Promise<{ state: SourceTestSummary['robots']; crawlDelaySeconds: number | null }> {
  const base = new URL(baseUrl);
  let response;
  try {
    response = await client.get(new URL('/robots.txt', base).toString(), {
      maxBytes: ROBOTS_MAX_BYTES,
      accept: 'text/plain,*/*;q=0.5',
    });
  } catch (error) {
    throw asSourceError(error);
  }
  const rules = interpretRobotsResponse(response.status, response.body.toString('utf8'));
  if (rules === null) {
    throw new SourceReadError('ROBOTS_UNAVAILABLE', 'SOURCE_ERROR', String(response.status));
  }
  if (rules.crawlDelaySeconds !== null) client.setMinInterval(rules.crawlDelaySeconds * 1000);
  const productsPath = new URL(
    'wp-json/wc/store/v1/products',
    base.href.endsWith('/') ? base.href : `${base.href}/`,
  ).pathname;
  if (!robotsAllows(rules, `${productsPath}?page=1&per_page=${pageSize}`)) {
    throw new SourceReadError('ROBOTS_DISALLOWED', 'SOURCE_ERROR');
  }
  return {
    state: response.status >= 400 ? 'NO_FILE' : 'ALLOWED',
    crawlDelaySeconds: rules.crawlDelaySeconds,
  };
}

export async function runSourceTest(options: {
  client: HttpClient;
  baseUrl: string;
  sampleSize?: number;
}): Promise<SourceTestResult> {
  const { client } = options;
  const size = Math.min(options.sampleSize ?? SAMPLE_SIZE, SAMPLE_SIZE);
  try {
    // 1. robots.txt of the host, before anything else.
    const robots = await checkRobots(client, options.baseUrl, size);
    const robotsState = robots.state;
    const crawlDelaySeconds = robots.crawlDelaySeconds;

    // 2. One page of the product list.
    const adapter = createStoreApiAdapter(client, options.baseUrl);
    const page = await adapter.listPage(1, size);
    const problemsByProduct = page.problems;
    const sample = page.records.map((record) =>
      entry(
        record,
        problemsByProduct.find((item) => item.key === record.sourceKey)?.problems ?? [],
      ),
    );
    const sampled = page.keys.length;
    const count = (test: (record: SourceProductRecord) => boolean) =>
      page.records.filter(test).length;
    const summary: SourceTestSummary = {
      total: page.total,
      sampled,
      usable: page.records.length,
      withSku: count((record) => record.sku !== null),
      withPrice: count((record) => record.priceVnd !== null),
      withImages: count((record) => record.images.length > 0),
      withCategory: count((record) => record.categoryNames.length > 0),
      withDescription: count(
        (record) => (record.descriptionText ?? record.shortDescriptionText) !== null,
      ),
      robots: robotsState,
      crawlDelaySeconds,
    };
    const problems = groupProblems(problemsByProduct);
    const fail = (
      code: Extract<SourceTestResult, { outcome: 'FAILED' }>['failure']['code'],
    ): SourceTestResult => ({
      outcome: 'FAILED',
      failure: { code, status: 'ADAPTER_REQUIRED' },
      summary,
      sample,
      problems,
      requests: client.requestCount(),
    });
    if (sampled === 0) return fail('EMPTY');
    if (summary.usable < sampled * PASS_RULES.minUsableShare) return fail('TOO_FEW_USABLE');
    if (summary.withPrice < summary.usable * PASS_RULES.minPriceShare)
      return fail('TOO_FEW_PRICES');
    if (summary.withImages < summary.usable * PASS_RULES.minImageShare)
      return fail('TOO_FEW_IMAGES');
    return { outcome: 'PASSED', summary, sample, problems, requests: client.requestCount() };
  } catch (error) {
    const failure = asSourceError(error);
    return {
      outcome: 'FAILED',
      failure: {
        code: failure.code,
        status: failure.status,
        ...(failure.detail ? { detail: failure.detail } : {}),
      },
      summary: null,
      sample: [],
      problems: [],
      requests: client.requestCount(),
    };
  }
}
