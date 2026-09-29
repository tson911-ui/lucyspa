-- Commit enum extensions separately before constraints reference the new values.
ALTER TYPE "ScopeKind" ADD VALUE 'REGION';
ALTER TYPE "ScopeKind" ADD VALUE 'AREA';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_ORGANIZATION';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_ORGANIZATION';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_ORG_ASSIGNMENTS';
ALTER TYPE "PermissionCode" ADD VALUE 'VIEW_TEAMS';
ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_TEAMS';
