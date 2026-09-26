import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../platform/prisma.service.js';
import { evaluateSequence, feasibleStarts, validateAssignment } from './availability.engine.js';
import type {
  AssignmentCheck,
  SequenceAtRequest,
  SequenceEvaluation,
  SequenceRequest,
} from './availability.types.js';

/**
 * The read-only entry point of the Availability & Qualification Engine (contract section 15:
 * "read snapshot; no locks"). Each lookup runs in one REPEATABLE READ transaction so all of its
 * facts come from one snapshot. A result is advisory: it reserves nothing. A later write
 * transaction must lock (`lockAvailabilitySubjects`) and re-check (`validateAssignment`) with its
 * own transaction client before persisting an assignment.
 */
@Injectable()
export class AvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  evaluate(request: SequenceAtRequest): Promise<SequenceEvaluation> {
    return this.snapshot((tx) => evaluateSequence(tx, request));
  }

  feasibleStarts(
    request: SequenceRequest & { stepMinutes?: number },
  ): Promise<{ startMinute: number; singleEmployeeAvailable: boolean }[]> {
    return this.snapshot((tx) => feasibleStarts(tx, request));
  }

  validate(
    request: SequenceAtRequest & { assignments: readonly string[] },
  ): Promise<AssignmentCheck> {
    return this.snapshot((tx) => validateAssignment(tx, request));
  }

  private snapshot<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction(work, { isolationLevel: 'RepeatableRead' });
  }
}
