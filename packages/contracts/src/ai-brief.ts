/**
 * Claude integration Wave D (CI-S2 and CI-S3, design sections 7.2 and 7.3): what the staff member serving a visit may see about the customer
 * on the work screen, and up to three product talking points. Shown only to the person assigned to that service line, who holds
 * "Xem thông tin khách" (`VIEW_CUSTOMER_BRIEF`) at the branch, while the visit is open; every view is audited. Nothing here is sent to the
 * customer. The AI part is switched off until the Owner turns it on (a lawyer check comes first, design 9.3).
 */

export const BRIEF_LIMITS = {
  /** The notes the summary may read (the newest), and the most characters of each. */
  notesMax: 6,
  noteChars: 300,
  /** The longest summary and the longest talking-point line, in characters. */
  summaryChars: 400,
  lineChars: 200,
  /** Talking points shown, and the products the model may pick from (chosen by code). */
  suggestions: 3,
  candidates: 8,
  /** The brief opens this long before the planned start; it is kept this many days after the service. */
  windowBeforeMinutes: 120,
  keepDaysAfterService: 7,
  /** A product bought by this customer in this many days is not suggested again. */
  boughtWithinDays: 60,
} as const;

/** Why the AI part cannot be used right now; the facts of the brief never need the AI. */
export type BriefBlock = 'AI_OFF' | 'BRIEF_OFF' | 'NO_RATE' | 'NO_KEY';

/** The facts computed by code from this customer's earlier visits at the branch (no AI). */
export interface CustomerBriefFacts {
  /** The customer has an account, so there is a history to read; a guest or a child has none. */
  known: boolean;
  /** Completed visits at this branch before this one. */
  visits: number;
  lastVisitDate: string | null;
  /** The staff member who served the last visit (the first of its services). */
  lastKtvName: string | null;
  /** Average days between completed visits (null with fewer than two). */
  averageGapDays: number | null;
  usualServices: { name: string; times: number }[];
  /** Names only of cosmetics bought before. */
  productsBefore: string[];
  /** How many notes staff wrote about the customer. */
  notes: number;
}

/** GET /api/v1/briefs/lines/:lineId */
export interface CustomerBrief {
  /** False while the feature is switched off: nothing else is filled. */
  available: boolean;
  block: BriefBlock | null;
  facts: CustomerBriefFacts | null;
  /** Two or three plain lines that only repeat what staff wrote; null when there are no notes or none could be made. */
  summary: string | null;
  summaryStatus: 'NONE' | 'READY' | 'UNAVAILABLE';
}

export interface ProductSuggestion {
  productId: string;
  name: string;
  /** One factual line from the product's approved description. */
  line: string;
}

/** GET /api/v1/briefs/lines/:lineId/suggestions */
export interface ProductSuggestions {
  available: boolean;
  block: BriefBlock | null;
  items: ProductSuggestion[];
  status: 'NONE' | 'READY' | 'UNAVAILABLE';
}
