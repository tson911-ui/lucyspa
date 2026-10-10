import { IMPORTER_ROBOTS_TOKEN } from './http-client.js';

/**
 * Phase 9 P9-3: robots.txt (RFC 9309). The importer reads it before anything else and treats a later `Disallow` as binding.
 *
 * - The group of our own token (`LucySpaCatalogBot`) is used when there is one, otherwise the `*` group, otherwise everything is allowed.
 * - Within a group the longest matching rule wins; on a tie `Allow` wins. `*` and a closing `$` work as in the RFC.
 * - A missing file (4xx other than 429) allows everything; an unreachable one (5xx, 429, network) allows nothing for this run.
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsRules {
  rules: RobotsRule[];
  /** Seconds, from `Crawl-delay`, of the group in force (null when absent). */
  crawlDelaySeconds: number | null;
}

const ALLOW_ALL: RobotsRules = { rules: [], crawlDelaySeconds: null };
const DISALLOW_ALL: RobotsRules = {
  rules: [{ allow: false, pattern: '/' }],
  crawlDelaySeconds: null,
};
export const ROBOTS_MAX_BYTES = 512 * 1024;

interface Group {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

export function parseRobots(text: string, token: string = IMPORTER_ROBOTS_TOKEN): RobotsRules {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const rawLine of text.slice(0, ROBOTS_MAX_BYTES).split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line === '') continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      if (!collectingAgents || current === null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (current === null) continue;
    if (field === 'allow' || field === 'disallow') {
      // An empty Disallow means "nothing is disallowed"; an empty Allow is ignored.
      if (value !== '') current.rules.push({ allow: field === 'allow', pattern: value });
    } else if (field === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
    }
  }
  const mine = token.toLowerCase();
  const own = groups.filter((group) => group.agents.includes(mine));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes('*'));
  if (chosen.length === 0) return ALLOW_ALL;
  const delays = chosen.map((group) => group.crawlDelay).filter((d): d is number => d !== null);
  return {
    rules: chosen.flatMap((group) => group.rules),
    crawlDelaySeconds: delays.length > 0 ? Math.max(...delays) : null,
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

/** `path` is the path plus query of the URL about to be requested. */
export function robotsAllows(robots: RobotsRules, path: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of robots.rules) {
    if (!matches(rule.pattern, path)) continue;
    if (
      best === null ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best === null ? true : best.allow;
}

/** What a robots.txt response means: the parsed rules, or null when the file could not be trusted (treated as disallow-all). */
export function interpretRobotsResponse(status: number, body: string): RobotsRules | null {
  if (status >= 200 && status < 300) return parseRobots(body);
  if (status === 429 || status >= 500) return null;
  // 3xx that did not resolve, 401/403/404/410 and the like: no usable file, so no restrictions (RFC 9309 2.3.1.3).
  return status >= 400 && status < 500 ? ALLOW_ALL : null;
}

export const ROBOTS_DISALLOW_ALL = DISALLOW_ALL;
