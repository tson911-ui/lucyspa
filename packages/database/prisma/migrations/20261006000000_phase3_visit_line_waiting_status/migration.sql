-- Phase 3 Step 6 foundation amendment (Owner-approved): a walk-in service line may wait for
-- capacity. The enum value is added in its own migration so later migrations can use it.
ALTER TYPE "VisitServiceLineStatus" ADD VALUE 'WAITING' BEFORE 'PLANNED';
