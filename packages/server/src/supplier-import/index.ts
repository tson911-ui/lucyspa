export { isBlockedAddress } from './net-guard.js';
export {
  createGuardedHttpClient,
  createGuardedLookup,
  HttpFetchError,
  httpsTransport,
  IMAGE_MAX_BYTES,
  IMPORTER_ROBOTS_TOKEN,
  IMPORTER_USER_AGENT,
  MIN_INTERVAL_MS,
  PAGE_MAX_BYTES,
  REQUEST_TIMEOUT_MS,
  type GetOptions,
  type GuardedClientOptions,
  type HttpClient,
  type HttpFailureCode,
  type HttpResponse,
  type Resolve,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './http-client.js';
export {
  interpretRobotsResponse,
  parseRobots,
  robotsAllows,
  ROBOTS_MAX_BYTES,
  type RobotsRule,
  type RobotsRules,
} from './robots.js';
export {
  canonicalJson,
  decodeEntities,
  hashOf,
  htmlToPlainText,
  plainLine,
  sha256Text,
} from './text.js';
export {
  asSourceError,
  createStoreApiAdapter,
  MAX_IMAGES_KEPT,
  normalizeStoreProduct,
  SourceReadError,
  STORE_API_ADAPTER_KEY,
  type FailureStatus,
  type NormalizedProduct,
  type ProductPage,
  type RecordProblem,
  type SourceAttribute,
  type SourceFailureCode,
  type SourceImage,
  type SourceProductRecord,
  type SourceVariationRef,
  type StoreApiAdapter,
} from './woocommerce-store.js';
export {
  PASS_RULES,
  runSourceTest,
  SAMPLE_SIZE,
  type SampleEntry,
  type SourceTestResult,
  type SourceTestSummary,
  type TestProblemGroup,
} from './source-test.js';
export {
  failExpiredSourceTests,
  processNextSourceTest,
  SOURCE_TEST_LEASE_MINUTES,
  type SourceTestDatabase,
} from './source-test-runner.js';
export {
  failExpiredScans,
  processNextScan,
  SCAN_LEASE_MINUTES,
  type ScanDatabase,
  type ScanDeps,
  type ScanError,
} from './source-scan.js';
export {
  downloadImage,
  imageFilename,
  isPlaceholderImage,
  MAX_IMAGES_PER_PRODUCT,
  NEAR_DUPLICATE_DISTANCE,
  type ImageFlag,
} from './image-intake.js';
export { checkRobots } from './source-test.js';
export {
  DECIDED_STATES,
  evaluateCandidate,
  EVALUATION_CODES,
  extractVolumes,
  foldText,
  GENERATED_SKU_PREFIX_BY_HOST,
  hostOf,
  LUCY_SKU,
  nameKey,
  proposeSku,
  type CandidateWarning,
  type EvaluationContext,
  type EvaluationInput,
  type EvaluationResult,
} from './candidate-rules.js';
export {
  evaluateCandidates,
  saveMapping,
  type EvaluationSummary,
  type MappingInput,
} from './candidate-evaluation.js';
