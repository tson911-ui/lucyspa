-- Employee management follow-up Step 2: COLLABORATOR (CTV) employment classification.
-- A classification, not a role: collaborators log in, work at their branches, hold skills
-- and are paid per scheduled occurrence (later step), never a fixed base salary.
-- Added alone: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "EmploymentClassification" ADD VALUE 'COLLABORATOR' BEFORE 'OFFICIAL_EMPLOYEE';
