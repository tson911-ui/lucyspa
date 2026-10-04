-- Phase 5 P5-3: the outcomes the `loyalty` outbox consumer records (design 11.1), added to the closed set. The
-- notifications consumer keeps its three outcomes; the loyalty consumer records what it did with each invoice event.
-- No data is changed.
ALTER TABLE "outbox_consumptions" DROP CONSTRAINT "outbox_consumptions_outcome_check";
ALTER TABLE "outbox_consumptions"
  ADD CONSTRAINT "outbox_consumptions_outcome_check" CHECK (
    "outcome" IN ('PUBLISHED', 'SKIPPED', 'UNROUTABLE', 'APPLIED', 'SKIPPED_GUEST', 'SKIPPED_PRE_GO_LIVE',
      'SKIPPED_STALE', 'SKIPPED_NOT_MEMBER', 'NOOP')
  );
