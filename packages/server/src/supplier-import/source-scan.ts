import { randomUUID } from 'node:crypto';
import type { DatabaseClient, Prisma } from '@lucy-spa/database';
import { discardMediaObjects, putProcessedImage, storedKeys } from '../media-assets.js';
import type { MediaStorage } from '../media-storage.js';
import {
  downloadImage,
  imageFilename,
  isPlaceholderImage,
  MAX_IMAGES_PER_PRODUCT,
  recordIntake,
  warnCandidate,
} from './image-intake.js';
import { takeSharedAuthGraphLock } from '../auth-lock.js';
import { createGuardedHttpClient, type HttpClient } from './http-client.js';
import { evaluateCandidates } from './candidate-evaluation.js';
import { notifySupplierImportChanges } from './import-notice.js';
import {
  contentDiff,
  imageDiff,
  isSuspectCount,
  nextMissing,
  returnedAfterRemoval,
  type PriceChangeDetail,
  type ScanChangeCounts,
} from './resync.js';
import { checkRobots, SAMPLE_SIZE } from './source-test.js';
import {
  asSourceError,
  createStoreApiAdapter,
  type SourceProductRecord,
  type StoreApiAdapter,
} from './woocommerce-store.js';

/**
 * Phase 9 P9-4: the sample scan. A manual scan (queued by the API, run only here) reads at most 20 products of a source: the first scan
 * takes the first page of the product list, a rescan re-reads only the products it already knows. Each product becomes a source
 * record (what the source says) plus a minimal candidate (the Lucy-side draft, name equal to the source name and flagged for
 * translation); source prices are appended as reference observations; nothing is ever written to a cost or a selling price.
 *
 * Pictures (only when the permission covers images): taken from the product's OWN record, checked against a fresh read of the same
 * product id, downloaded through the guarded client and recorded with the source product id and URL. See `image-intake.ts` for the
 * rules that keep a picture on its product. Every unit of work (one product, one picture) is its own transaction, so one failure never
 * undoes the rest; failures become scan errors and candidate warnings, never silence.
 */

export const SCAN_LEASE_MINUTES = 3;
/** The most products one full scan reads (and one source keeps; the database says the same). */
export const FULL_SCAN_LIMIT = 2000;
const MAX_ERRORS = 50;
const MAX_VARIATIONS_READ = 10;
const DECIDED = ['APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED'];

/** The worker passes its client; a test may pass a transaction client so everything rolls back. */
export type ScanDatabase = DatabaseClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;
type ClientFactory = (baseUrl: string) => HttpClient;

const defaultClient: ClientFactory = (baseUrl) =>
  createGuardedHttpClient({ allowedHosts: [new URL(baseUrl).hostname] });

export interface ScanDeps {
  createClient?: ClientFactory;
  /** Where picture objects are written; null when the worker has no media directory (pictures are then reported, not skipped silently). */
  storage: MediaStorage | null;
  /** SKU prefixes for sources that sell products without a SKU, by host (default: the Owner's approved list, haruohui only). */
  skuPrefixes?: Readonly<Record<string, string>>;
}

export interface ScanError {
  code: string;
  key?: string;
  url?: string;
  detail?: string;
}

/** One unit of work in its own transaction; inside a test's transaction client a savepoint isolates a failing unit. */
export async function inUnit<T>(database: ScanDatabase, work: (tx: Tx) => Promise<T>): Promise<T> {
  if ('$transaction' in database) {
    return (database as DatabaseClient).$transaction(work, { timeout: 60_000 });
  }
  const tx = database as Tx;
  const name = `scan_${randomUUID().replaceAll('-', '')}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const result = await work(tx);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    throw error;
  }
}

/** Fails scans whose lease ran out (the worker died while the scan was running). Returns how many. */
export async function failExpiredScans(database: ScanDatabase): Promise<number> {
  const rows = await database.$queryRaw<{ id: string }[]>`
    UPDATE import_scans
       SET status = 'FAILED', finished_at = clock_timestamp(), error_count = error_count + 1,
           errors = errors || '[{"code":"WORKER_LOST"}]'::jsonb
     WHERE status = 'RUNNING' AND claimed_at IS NOT NULL AND lease_expires_at < clock_timestamp()
    RETURNING id`;
  return rows.length;
}

interface Claimed {
  id: string;
  source_id: string;
  actor_user_id: string | null;
  sample_limit: number;
  scope: string;
}

/** The last healthy scan of the source (SUCCEEDED or PARTIAL): how many products it found. Null for a source never scanned. */
async function healthyBaseline(
  database: ScanDatabase,
  sourceId: string,
  scanId: string,
  scope: string,
): Promise<number | null> {
  // Only a scan of the same scope is comparable: a 20-product sample next to a full read of 352 is not a drop.
  const rows = await database.$queryRaw<{ discovered_count: number }[]>`
    SELECT discovered_count FROM import_scans
     WHERE source_id = ${sourceId}::uuid AND id <> ${scanId}::uuid AND scope = ${scope} AND status IN ('SUCCEEDED', 'PARTIAL')
     ORDER BY started_at DESC, id DESC LIMIT 1`;
  return rows[0]?.discovered_count ?? null;
}

async function claim(database: ScanDatabase): Promise<Claimed | null> {
  const rows = await database.$queryRaw<Claimed[]>`
    UPDATE import_scans
       SET claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(mins => ${SCAN_LEASE_MINUTES})
     WHERE id = (SELECT id FROM import_scans WHERE status = 'RUNNING' AND claimed_at IS NULL
                  ORDER BY started_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, source_id, actor_user_id, sample_limit, scope`;
  return rows[0] ?? null;
}

interface SourceFacts {
  supplierId: string;
  name: string;
  /** Who confirmed the permission: the owner of pictures a scheduled scan (no person) downloads. */
  confirmedByUserId: string | null;
  baseUrl: string | null;
  kind: string;
  status: string;
  isEnabled: boolean;
  confirmed: boolean;
  permitsText: boolean;
  permitsImages: boolean;
}

interface Counters {
  discovered: number;
  fresh: number;
  unchanged: number;
  priceChanged: number;
  contentChanged: number;
  imageChanged: number;
  /** Products raised as no longer on the source (missing from the third healthy scan in a row). */
  removed: number;
  images: number;
  /** Distinct pictures flagged during the scan (not flag events). */
  flaggedImages: Set<string>;
}

interface Work {
  record: SourceProductRecord;
  recordId: string;
  candidateId: string;
}

type SourceChangeKind =
  'PRICE_CHANGED' | 'CONTENT_CHANGED' | 'IMAGE_CHANGED' | 'SOURCE_REMOVED' | 'SOURCE_RETURNED';
const json = (value: unknown) => value as Prisma.InputJsonValue;

function recordData(record: SourceProductRecord, permitsText: boolean) {
  return {
    url: record.url,
    name: record.name,
    sku: record.sku,
    // Text beyond the name and the identifiers is stored only when the permission covers text.
    brandText: permitsText ? record.brandText : null,
    categoryPath: json(permitsText ? record.categoryNames : []),
    descriptionText: permitsText ? record.descriptionText : null,
    attributes: json(
      permitsText ? Object.fromEntries(record.attributes.map((a) => [a.name, a.values])) : {},
    ),
    imageUrls: json(record.images.map((image) => image.url)),
    contentHash: record.contentHash,
    priceHash: record.priceHash,
    imagesHash: record.imagesHash,
  };
}

/**
 * Finishes a scan row. `listed` says whether the product list was read at all and the scan was healthy (a failed or suspect listing
 * is not a "success"). A healthy scan that found something tells the holders of the review permission, in the same transaction.
 */
async function finish(
  database: ScanDatabase,
  scan: { id: string; sourceId: string; actorUserId: string | null; sourceName: string | null },
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SUSPECT',
  counters: Counters,
  errors: ScanError[],
  requests: number,
  listed: boolean,
): Promise<void> {
  const scanId = scan.id;
  const sourceId = scan.sourceId;
  const done = await inUnit(database, async (tx) => {
    // Lock order of the whole system: the authorization graph first (the notice reads who holds the permission), then the source.
    await takeSharedAuthGraphLock(tx);
    await tx.$queryRaw`SELECT id FROM supplier_sources WHERE id = ${sourceId}::uuid FOR UPDATE`;
    const finished = await tx.$executeRaw`
      UPDATE import_scans
         SET status = ${status}::"ImportScanStatus", finished_at = clock_timestamp(),
             discovered_count = ${counters.discovered}, new_count = ${counters.fresh},
             unchanged_count = ${counters.unchanged}, price_changed_count = ${counters.priceChanged},
             content_changed_count = ${counters.contentChanged}, image_changed_count = ${counters.imageChanged},
             removed_count = ${counters.removed},
             duplicate_count = ${counters.flaggedImages.size}, error_count = ${errors.length},
             errors = ${JSON.stringify(errors.slice(0, MAX_ERRORS))}::jsonb,
             request_count = ${requests}, image_count = ${counters.images}, image_flag_count = ${counters.flaggedImages.size}
       WHERE id = ${scanId}::uuid AND status = 'RUNNING'`;
    if (finished === 0) return false;
    if (listed) {
      await tx.$executeRaw`
        UPDATE supplier_sources SET last_success_at = clock_timestamp(), row_version = row_version + 1
         WHERE id = ${sourceId}::uuid`;
    }
    return true;
  });
  if (
    !done ||
    !listed ||
    (status !== 'SUCCEEDED' && status !== 'PARTIAL') ||
    scan.sourceName === null
  )
    return;
  // The notice is its own unit: a failure here loses the notice but can never leave the scan unfinished.
  try {
    const counts: ScanChangeCounts = {
      created: counters.fresh,
      priceChanged: counters.priceChanged,
      contentChanged: counters.contentChanged,
      imageChanged: counters.imageChanged,
      removed: counters.removed,
    };
    const sourceName = scan.sourceName;
    await inUnit(database, async (tx) => {
      await takeSharedAuthGraphLock(tx);
      await notifySupplierImportChanges(tx, {
        sourceId,
        sourceName,
        scanId,
        actorUserId: scan.actorUserId,
        counts,
      });
    });
  } catch {
    // Nothing to do: the scan is final and the sources screen shows its counts.
  }
}

/** Runs at most one queued scan. Returns its final status, or null when nothing was queued. */
export async function processNextScan(
  database: ScanDatabase,
  deps: ScanDeps,
): Promise<'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'SUSPECT' | null> {
  await failExpiredScans(database);
  const scan = await claim(database);
  if (!scan) return null;
  const counters: Counters = {
    discovered: 0,
    fresh: 0,
    unchanged: 0,
    priceChanged: 0,
    contentChanged: 0,
    imageChanged: 0,
    removed: 0,
    images: 0,
    flaggedImages: new Set<string>(),
  };
  const errors: ScanError[] = [];
  const scanInfo = {
    id: scan.id,
    sourceId: scan.source_id,
    actorUserId: scan.actor_user_id,
    sourceName: null as string | null,
  };
  const note = (error: ScanError) => {
    if (errors.length < MAX_ERRORS * 2) errors.push(error);
  };
  const [row] = await database.$queryRaw<
    {
      supplier_id: string;
      name: string;
      confirmed_by: string | null;
      base_url: string | null;
      kind: string;
      status: string;
      is_enabled: boolean;
      confirmed: boolean;
      permits_text: boolean;
      permits_images: boolean;
    }[]
  >`
    SELECT supplier_id, name, permission_confirmed_by_user_id AS confirmed_by, base_url, kind::text AS kind, status::text AS status, is_enabled,
           permission_confirmed_at IS NOT NULL AS confirmed, permits_text, permits_images
      FROM supplier_sources WHERE id = ${scan.source_id}::uuid`;
  const source: SourceFacts | null = row
    ? {
        supplierId: row.supplier_id,
        name: row.name,
        confirmedByUserId: row.confirmed_by,
        baseUrl: row.base_url,
        kind: row.kind,
        status: row.status,
        isEnabled: row.is_enabled,
        confirmed: row.confirmed,
        permitsText: row.permits_text,
        permitsImages: row.permits_images,
      }
    : null;
  scanInfo.sourceName = source?.name ?? null;
  // Nothing is requested from a site unless the source is enabled, READY and still has a confirmed permission.
  if (
    !source ||
    !source.isEnabled ||
    source.status !== 'READY' ||
    !source.confirmed ||
    source.baseUrl === null ||
    source.kind === 'FILE' ||
    (!source.permitsText && !source.permitsImages)
  ) {
    note({ code: 'SOURCE_NOT_READY' });
    await finish(database, scanInfo, 'FAILED', counters, errors, 0, false);
    return 'FAILED';
  }

  const client = (deps.createClient ?? defaultClient)(source.baseUrl);
  const renew = async () => {
    await database.$executeRaw`
      UPDATE import_scans
         SET lease_expires_at = clock_timestamp() + make_interval(mins => ${SCAN_LEASE_MINUTES})
       WHERE id = ${scan.id}::uuid AND status = 'RUNNING'`;
  };
  let listed = false;
  try {
    // A sample reads at most 20 products; a full scan reads every product of the source (up to its own limit).
    const full = scan.scope === 'FULL';
    const limit = full ? scan.sample_limit : Math.min(scan.sample_limit, SAMPLE_SIZE);
    await checkRobots(client, source.baseUrl, Math.min(limit, SAMPLE_SIZE));
    const adapter = createStoreApiAdapter(client, source.baseUrl);
    const known = await database.$queryRaw<{ source_key: string }[]>`
      SELECT source_key FROM source_records WHERE source_id = ${scan.source_id}::uuid ORDER BY source_key LIMIT ${limit}`;
    // A full scan lists every product. A sample: the first page of the list on the first scan, then only the products already known
    // (the sample never grows by itself).
    const page = full
      ? await adapter.listAll(limit)
      : known.length === 0
        ? await adapter.listPage(1, limit)
        : await adapter.fetchMany(known.map((entry) => entry.source_key));
    listed = true;
    const records = page.records.slice(0, limit);
    counters.discovered = records.length;
    const returnedKeys = new Set(records.map((record) => record.sourceKey));
    const problemKeys = new Set(page.problems.flatMap((group) => (group.key ? [group.key] : [])));
    const absent = known.filter((entry) => !returnedKeys.has(entry.source_key));
    for (const missing of absent) note({ code: 'PRODUCT_NOT_RETURNED', key: missing.source_key });
    for (const group of page.problems) {
      for (const problem of group.problems.filter((p) => p.fatal)) {
        note({ code: `PRODUCT_${problem.code}`, ...(group.key ? { key: group.key } : {}) });
      }
    }

    // 0. Health, BEFORE anything is written: a read that found fewer than 70% of what the last healthy scan found is suspect (a broken
    // adapter, a half-loaded site, an outage). A suspect scan writes only its own row: no record changes, nothing counted as missing,
    // no pictures, no notice, and the source is not marked as successfully read.
    const baseline = await healthyBaseline(database, scan.source_id, scan.id, scan.scope);
    if (isSuspectCount(records.length, baseline)) {
      note({ code: 'SCAN_SUSPECT', detail: `${records.length} of ${baseline}` });
      await finish(database, scanInfo, 'SUSPECT', counters, errors, client.requestCount(), false);
      return 'SUSPECT';
    }

    // 1. Records, prices and minimal candidates.
    const work: Work[] = [];
    for (const record of records) {
      try {
        const saved = await inUnit(database, (tx) =>
          upsertRecord(tx, scan.id, scan.source_id, source, record, counters),
        );
        work.push({ record, ...saved });
      } catch {
        note({ code: 'RECORD_FAILED', key: record.sourceKey });
      }
    }
    // 1b. Products this healthy scan did not get back. A product the site returned a fatal problem for is not missing, only unreadable.
    for (const entry of absent.filter((candidate) => !problemKeys.has(candidate.source_key))) {
      try {
        await inUnit(database, (tx) =>
          markMissing(tx, scan.id, scan.source_id, entry.source_key, counters),
        );
      } catch {
        note({ code: 'MISSING_FAILED', key: entry.source_key });
      }
    }
    await renew();

    // 2. Pictures.
    if (source.permitsImages && work.length > 0) {
      await intakeAllImages({
        database,
        deps,
        client,
        adapter,
        source,
        // A scheduled scan has no person: its pictures belong to the person who confirmed the permission of the source.
        scanActor: scan.actor_user_id ?? source.confirmedByUserId,
        work,
        counters,
        note,
        renew,
      });
    }
    // 3. What a reviewer needs: proposed SKU, brand and category from the remembered mappings, duplicate suspicions, warnings, state.
    if (work.length > 0) {
      try {
        await inUnit(database, (tx) =>
          evaluateCandidates(
            tx,
            { candidateIds: work.map((item) => item.candidateId) },
            deps.skuPrefixes ? { skuPrefixes: deps.skuPrefixes } : {},
          ),
        );
      } catch {
        note({ code: 'EVALUATE_FAILED' });
      }
    }
    const status = errors.length === 0 ? 'SUCCEEDED' : 'PARTIAL';
    await finish(database, scanInfo, status, counters, errors, client.requestCount(), listed);
    return status;
  } catch (error) {
    const failure = asSourceError(error);
    note({ code: failure.code, ...(failure.detail ? { detail: failure.detail } : {}) });
    await finish(database, scanInfo, 'FAILED', counters, errors, client.requestCount(), listed);
    return 'FAILED';
  }
}

async function upsertRecord(
  tx: Tx,
  scanId: string,
  sourceId: string,
  source: SourceFacts,
  record: SourceProductRecord,
  counters: Counters,
): Promise<{ recordId: string; candidateId: string }> {
  const existing = await tx.sourceRecord.findUnique({
    where: { sourceId_sourceKey: { sourceId, sourceKey: record.sourceKey } },
    select: {
      id: true,
      contentHash: true,
      priceHash: true,
      imagesHash: true,
      missingScans: true,
      name: true,
      sku: true,
      brandText: true,
      categoryPath: true,
      descriptionText: true,
      attributes: true,
      imageUrls: true,
      candidateLink: { select: { candidateId: true, candidate: { select: { state: true } } } },
    },
  });
  const observation = {
    priceVnd: record.priceVnd === null ? null : BigInt(record.priceVnd),
    promoPriceVnd: record.promoPriceVnd === null ? null : BigInt(record.promoPriceVnd),
    currency: record.currency === '' ? 'VND' : record.currency,
  };
  if (existing) {
    const changes: string[] = [];
    if (existing.contentHash !== record.contentHash) changes.push('CONTENT_CHANGED');
    if (existing.priceHash !== record.priceHash) changes.push('PRICE_CHANGED');
    if (existing.imagesHash !== record.imagesHash) changes.push('IMAGE_CHANGED');
    // The note a person reads (design section 10): what differs, small and structured. Written before the record is overwritten.
    const notes: { kind: SourceChangeKind; detail: object }[] = [];
    if (changes.includes('CONTENT_CHANGED')) {
      notes.push({
        kind: 'CONTENT_CHANGED',
        detail: contentDiff(existing, record, source.permitsText),
      });
    }
    if (changes.includes('PRICE_CHANGED')) {
      const before = await tx.sourcePriceObservation.findFirst({
        where: { sourceRecordId: existing.id },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        select: { priceVnd: true, promoPriceVnd: true },
      });
      const detail: PriceChangeDetail = {
        before: {
          priceVnd: before?.priceVnd == null ? null : Number(before.priceVnd),
          promoPriceVnd: before?.promoPriceVnd == null ? null : Number(before.promoPriceVnd),
        },
        after: { priceVnd: record.priceVnd, promoPriceVnd: record.promoPriceVnd },
      };
      notes.push({ kind: 'PRICE_CHANGED', detail });
    }
    if (changes.includes('IMAGE_CHANGED')) {
      notes.push({
        kind: 'IMAGE_CHANGED',
        detail: imageDiff(
          existing.imageUrls,
          record.images.map((image) => image.url),
        ),
      });
    }
    // The product was missing and is back. Only a product that had been raised as removed is worth a note.
    if (returnedAfterRemoval(existing.missingScans)) {
      notes.push({ kind: 'SOURCE_RETURNED', detail: { missingScans: existing.missingScans } });
    }
    if (notes.length > 0) {
      await tx.sourceChange.createMany({
        data: notes.map((entry) => ({
          sourceRecordId: existing.id,
          scanId,
          kind: entry.kind,
          detail: json(entry.detail),
        })),
        skipDuplicates: true,
      });
    }
    await tx.sourceRecord.update({
      where: { id: existing.id },
      data: {
        ...recordData(record, source.permitsText),
        lastSeenScanId: scanId,
        lastSeenAt: new Date(),
        lastChanges: json(changes.map((type) => ({ type, scanId }))),
        // Seen again: the count of healthy scans without it starts over.
        missingScans: 0,
        state: 'PRESENT',
      },
      select: { id: true },
    });
    await tx.sourcePriceObservation.create({
      data: { sourceRecordId: existing.id, scanId, ...observation },
      select: { id: true },
    });
    if (changes.length === 0) counters.unchanged += 1;
    if (changes.includes('CONTENT_CHANGED')) counters.contentChanged += 1;
    if (changes.includes('PRICE_CHANGED')) counters.priceChanged += 1;
    if (changes.includes('IMAGE_CHANGED')) counters.imageChanged += 1;
    if (!existing.candidateLink) throw new Error('source record without a candidate');
    // A product a person rejected or ignored is not proposed again, UNLESS its content at the source changed: then it is open again
    // for review (Owner, section 17). Its decision, person and note are cleared; the history stays in the audit trail and the notes.
    if (
      changes.includes('CONTENT_CHANGED') &&
      (existing.candidateLink.candidate.state === 'IGNORED' ||
        existing.candidateLink.candidate.state === 'REJECTED')
    ) {
      await tx.$executeRaw`
        UPDATE import_candidates
           SET state = 'EXTRACTED'::"ImportCandidateState", decided_by_user_id = NULL, decided_at = NULL, decision_note = NULL,
               row_version = row_version + 1
         WHERE id = ${existing.candidateLink.candidateId}::uuid AND state IN ('IGNORED', 'REJECTED')`;
    }
    return { recordId: existing.id, candidateId: existing.candidateLink.candidateId };
  }
  const created = await tx.sourceRecord.create({
    data: {
      sourceId,
      sourceKey: record.sourceKey,
      ...recordData(record, source.permitsText),
      firstSeenScanId: scanId,
      lastSeenScanId: scanId,
    },
    select: { id: true },
  });
  await tx.sourcePriceObservation.create({
    data: { sourceRecordId: created.id, scanId, ...observation },
    select: { id: true },
  });
  const candidate = await tx.importCandidate.create({
    data: {
      supplierId: source.supplierId,
      state: 'EXTRACTED',
      nameVi: record.name,
      // No English name at the source: it starts equal to the Vietnamese one and stays flagged for translation (Owner answer 4).
      nameEn: record.name,
      needsTranslation: true,
      descriptionVi: source.permitsText ? record.descriptionText : null,
      brandText: source.permitsText ? record.brandText : null,
      categoryPath: json(source.permitsText ? record.categoryNames : []),
    },
    select: { id: true },
  });
  await tx.candidateSource.create({
    data: { candidateId: candidate.id, sourceRecordId: created.id, matchKind: 'EXACT' },
  });
  counters.fresh += 1;
  return { recordId: created.id, candidateId: candidate.id };
}

/**
 * One more healthy scan in which the list did not return this known product. Only the count moves (the record, its candidate, its
 * pictures and any product made from it are untouched). The third scan in a row raises one removal note; later scans only count.
 */
async function markMissing(
  tx: Tx,
  scanId: string,
  sourceId: string,
  sourceKey: string,
  counters: Counters,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string; missing_scans: number }[]>`
    SELECT id, missing_scans FROM source_records
     WHERE source_id = ${sourceId}::uuid AND source_key = ${sourceKey} FOR UPDATE`;
  const row = rows[0];
  if (!row) return;
  const step = nextMissing(row.missing_scans);
  await tx.$executeRaw`
    UPDATE source_records SET missing_scans = ${step.missingScans}, state = 'MISSING', updated_at = clock_timestamp()
     WHERE id = ${row.id}::uuid`;
  if (step.removed) {
    await tx.sourceChange.createMany({
      data: [
        {
          sourceRecordId: row.id,
          scanId,
          kind: 'SOURCE_REMOVED',
          detail: json({ missingScans: step.missingScans }),
        },
      ],
      skipDuplicates: true,
    });
    counters.removed += 1;
  }
}

// ------------------------------------------------------------------------------------------------------------- pictures

interface WantedImage {
  url: string;
  variantKey: string | null;
}

async function intakeAllImages(context: {
  database: ScanDatabase;
  deps: ScanDeps;
  client: HttpClient;
  adapter: StoreApiAdapter;
  source: SourceFacts;
  scanActor: string | null;
  work: Work[];
  counters: Counters;
  note: (error: ScanError) => void;
  renew: () => Promise<void>;
}): Promise<void> {
  const { adapter, work, note, renew } = context;
  if (context.scanActor === null) {
    // A scheduled scan has no person to own the new library assets yet (P9-7); a manual scan always has one.
    note({ code: 'IMAGE_ACTOR_MISSING' });
    return;
  }
  const actorUserId = context.scanActor;
  // The check at download time: every product is read AGAIN by its id; a picture is taken only if the fresh read of the same product
  // id lists it.
  let verified: Map<string, SourceProductRecord>;
  try {
    const fresh = await adapter.fetchMany(work.map((item) => item.record.sourceKey));
    verified = new Map(fresh.records.map((record) => [record.sourceKey, record]));
  } catch (error) {
    note({ code: 'IMAGE_VERIFY_FAILED', detail: asSourceError(error).code });
    return;
  }
  for (const item of work) {
    try {
      await intakeProduct({
        ...context,
        item,
        verifiedRecord: verified.get(item.record.sourceKey) ?? null,
        actorUserId,
      });
    } catch {
      note({ code: 'IMAGE_PRODUCT_FAILED', key: item.record.sourceKey });
    }
    await renew();
  }
}

async function intakeProduct(context: {
  database: ScanDatabase;
  deps: ScanDeps;
  client: HttpClient;
  adapter: StoreApiAdapter;
  source: SourceFacts;
  item: Work;
  verifiedRecord: SourceProductRecord | null;
  actorUserId: string;
  counters: Counters;
  note: (error: ScanError) => void;
}): Promise<void> {
  const { database, deps, client, adapter, source, item, verifiedRecord, counters, note } = context;
  const { record, recordId, candidateId } = item;
  const key = record.sourceKey;
  const state = (
    await database.$queryRaw<{ state: string }[]>`
      SELECT state::text AS state FROM import_candidates WHERE id = ${candidateId}::uuid`
  )[0]?.state;
  if (state === undefined || DECIDED.includes(state)) return;
  if (!verifiedRecord) {
    note({ code: 'IMAGE_PROVENANCE_UNVERIFIED', key });
    return;
  }

  // What the product wants: its own pictures first (only those the fresh read of the same id also lists), then those of its variants.
  const allowed = new Set(verifiedRecord.images.map((image) => image.url));
  const wanted: WantedImage[] = [];
  for (const image of record.images) {
    if (isPlaceholderImage(image.url)) continue;
    if (!allowed.has(image.url)) {
      note({ code: 'IMAGE_PROVENANCE_MISMATCH', key, url: image.url });
      continue;
    }
    if (!wanted.some((entry) => entry.url === image.url))
      wanted.push({ url: image.url, variantKey: null });
  }
  if (record.type === 'variable') {
    for (const variation of record.variations.slice(0, MAX_VARIATIONS_READ)) {
      if (wanted.length >= MAX_IMAGES_PER_PRODUCT) break;
      let variant: SourceProductRecord | null;
      try {
        variant = await adapter.fetchProduct(variation.key);
      } catch (error) {
        note({ code: 'VARIATION_FAILED', key, detail: asSourceError(error).code });
        continue;
      }
      // A variation's pictures count only when its own record names this product as its parent.
      if (!variant || variant.sourceKey !== variation.key || variant.parentKey !== key) {
        note({ code: 'VARIATION_MISMATCH', key, detail: variation.key });
        continue;
      }
      for (const image of variant.images) {
        if (wanted.length >= MAX_IMAGES_PER_PRODUCT) break;
        if (isPlaceholderImage(image.url) || wanted.some((entry) => entry.url === image.url))
          continue;
        wanted.push({ url: image.url, variantKey: variation.key });
      }
    }
  }
  const desired = wanted.slice(0, MAX_IMAGES_PER_PRODUCT);

  if (desired.length === 0) {
    await inUnit(database, (tx) =>
      warnCandidate(tx, candidateId, [{ code: 'IMAGE_MISSING' }], { needsReview: false }),
    );
  }

  // Pictures the source no longer lists for this record are retired (the position and the file become free); the rest are kept.
  const active = await database.candidateImage.findMany({
    where: { candidateId, sourceRecordId: recordId, retiredAt: null },
    select: { id: true, sourceUrl: true, sortOrder: true },
  });
  const stale = active.filter((row) => !desired.some((entry) => entry.url === row.sourceUrl));
  if (stale.length > 0) {
    await inUnit(database, async (tx) => {
      await tx.$executeRaw`
        UPDATE candidate_images SET retired_at = clock_timestamp()
         WHERE id = ANY(${stale.map((row) => row.id)}::uuid[]) AND retired_at IS NULL`;
    });
  }
  const used = new Set(
    (
      await database.candidateImage.findMany({
        where: { candidateId, retiredAt: null },
        select: { sortOrder: true },
      })
    ).map((row) => row.sortOrder),
  );
  const keptUrls = new Set(
    active.filter((row) => !stale.includes(row)).map((row) => row.sourceUrl),
  );
  const free = [...Array(MAX_IMAGES_PER_PRODUCT).keys()].filter((position) => !used.has(position));
  for (const entry of desired) {
    if (keptUrls.has(entry.url)) continue;
    const position = free.shift();
    if (position === undefined) break;
    if (deps.storage === null) {
      note({ code: 'MEDIA_STORAGE_UNAVAILABLE', key });
      return;
    }
    const downloaded = await downloadImage(client, entry.url);
    if (!downloaded.ok) {
      note({
        code: downloaded.failure.code,
        key,
        url: entry.url,
        ...(downloaded.failure.detail ? { detail: downloaded.failure.detail } : {}),
      });
      await inUnit(database, (tx) =>
        warnCandidate(
          tx,
          candidateId,
          [{ code: 'IMAGE_FAILED', reason: downloaded.failure.code, url: entry.url }],
          { needsReview: false },
        ),
      );
      free.unshift(position);
      continue;
    }
    const stored = await putProcessedImage(deps.storage, downloaded.value.image);
    try {
      const result = await inUnit(database, (tx) =>
        recordIntake({
          tx,
          supplierId: source.supplierId,
          candidateId,
          sourceRecordId: recordId,
          sourceProductKey: key,
          variantKey: entry.variantKey,
          sourceUrl: entry.url,
          sortOrder: position,
          filename: imageFilename(record.name, key, position),
          altVi: record.name.slice(0, 200),
          actorUserId: context.actorUserId,
          downloaded: downloaded.value,
          stored,
        }),
      );
      // The objects are the recorded ones only when the asset is new.
      if (result.duplicateAsset) await discardMediaObjects(deps.storage, storedKeys(stored));
      if (result.imageId === null) {
        free.unshift(position);
        continue;
      }
      counters.images += 1;
      for (const id of result.flaggedImageIds) counters.flaggedImages.add(id);
    } catch {
      await discardMediaObjects(deps.storage, storedKeys(stored));
      free.unshift(position);
      note({ code: 'IMAGE_RECORD_FAILED', key, url: entry.url });
    }
  }
}
