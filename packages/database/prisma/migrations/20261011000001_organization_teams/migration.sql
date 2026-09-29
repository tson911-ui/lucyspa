-- Additive organization data. No region, title, team or permission grant is inferred.
CREATE TYPE "OrganizationLevel" AS ENUM ('CEO','REGIONAL_MANAGER','AREA_MANAGER','STORE_MANAGER','DEPUTY_STORE_MANAGER','TEAM_LEADER');
CREATE TABLE regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
  name text NOT NULL, is_active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT regions_values CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$' AND name !~ '^[[:space:]]*$' AND row_version > 0)
);
CREATE TABLE areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), region_id uuid NOT NULL REFERENCES regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL UNIQUE, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT areas_values CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$' AND name !~ '^[[:space:]]*$' AND row_version > 0)
);
CREATE INDEX areas_region_active_idx ON areas(region_id,is_active);
ALTER TABLE branches ADD COLUMN area_id uuid REFERENCES areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE INDEX branches_area_idx ON branches(area_id);

ALTER TABLE user_role_assignments ADD COLUMN region_id uuid REFERENCES regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN area_id uuid REFERENCES areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CONSTRAINT user_role_assignments_scope_consistency,
  ADD CONSTRAINT user_role_assignments_scope_consistency CHECK (
    (scope_kind='GLOBAL' AND num_nonnulls(region_id,area_id,branch_id)=0) OR
    (scope_kind='REGION' AND region_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id)=1) OR
    (scope_kind='AREA' AND area_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id)=1) OR
    (scope_kind='BRANCH' AND branch_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id)=1)
  );
CREATE UNIQUE INDEX user_role_assignments_region_key ON user_role_assignments(user_id,role_id,region_id) WHERE scope_kind='REGION';
CREATE UNIQUE INDEX user_role_assignments_area_key ON user_role_assignments(user_id,role_id,area_id) WHERE scope_kind='AREA';
CREATE INDEX user_role_assignments_region_idx ON user_role_assignments(region_id);
CREATE INDEX user_role_assignments_area_idx ON user_role_assignments(area_id);
ALTER TABLE user_permission_overrides ADD COLUMN region_id uuid REFERENCES regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD COLUMN area_id uuid REFERENCES areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  DROP CONSTRAINT user_permission_overrides_scope_consistency,
  ADD CONSTRAINT user_permission_overrides_scope_consistency CHECK (
    (scope_kind='GLOBAL' AND num_nonnulls(region_id,area_id,branch_id)=0) OR
    (scope_kind='REGION' AND region_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id)=1) OR
    (scope_kind='AREA' AND area_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id)=1) OR
    (scope_kind='BRANCH' AND branch_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id)=1)
  );
CREATE UNIQUE INDEX user_permission_overrides_region_key ON user_permission_overrides(user_id,permission_id,region_id) WHERE scope_kind='REGION';
CREATE UNIQUE INDEX user_permission_overrides_area_key ON user_permission_overrides(user_id,permission_id,area_id) WHERE scope_kind='AREA';
CREATE INDEX user_permission_overrides_region_idx ON user_permission_overrides(region_id);
CREATE INDEX user_permission_overrides_area_idx ON user_permission_overrides(area_id);
CREATE OR REPLACE FUNCTION lucy_check_override_scope_capability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope_kind <> 'GLOBAL' AND EXISTS (
    SELECT 1 FROM permissions WHERE id=NEW.permission_id AND scope_capability='GLOBAL_ONLY'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='A GLOBAL_ONLY permission cannot be overridden at a subordinate scope';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  code text NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true, row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT teams_branch_code_key UNIQUE(branch_id,code), CONSTRAINT teams_id_branch_key UNIQUE(id,branch_id),
  CONSTRAINT teams_values CHECK (code ~ '^[A-Z][A-Z0-9_]{0,63}$' AND name !~ '^[[:space:]]*$' AND row_version > 0)
);
CREATE INDEX teams_branch_active_idx ON teams(branch_id,is_active,id);
CREATE TABLE organization_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_user_id uuid NOT NULL REFERENCES employee_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  level "OrganizationLevel" NOT NULL, scope_kind "ScopeKind" NOT NULL,
  region_id uuid REFERENCES regions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  area_id uuid REFERENCES areas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  team_id uuid REFERENCES teams(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  assigned_at timestamptz(3) NOT NULL DEFAULT now(), ended_at timestamptz(3),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT organization_assignments_scope_consistency CHECK (
    (level='CEO' AND scope_kind='GLOBAL' AND num_nonnulls(region_id,area_id,branch_id,team_id)=0) OR
    (level='REGIONAL_MANAGER' AND scope_kind='REGION' AND region_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id,team_id)=1) OR
    (level='AREA_MANAGER' AND scope_kind='AREA' AND area_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id,team_id)=1) OR
    (level IN ('STORE_MANAGER','DEPUTY_STORE_MANAGER') AND scope_kind='BRANCH' AND branch_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id,team_id)=1) OR
    (level='TEAM_LEADER' AND scope_kind='BRANCH' AND branch_id IS NOT NULL AND team_id IS NOT NULL AND num_nonnulls(region_id,area_id,branch_id,team_id)=2)
  ),
  CONSTRAINT organization_assignments_dates CHECK (ended_at IS NULL OR ended_at>=assigned_at),
  CONSTRAINT organization_assignments_version CHECK(row_version>0),
  CONSTRAINT organization_assignments_team_branch_fkey FOREIGN KEY(team_id,branch_id) REFERENCES teams(id,branch_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX organization_assignments_employee_active_idx ON organization_assignments(employee_user_id,ended_at);
CREATE INDEX organization_assignments_scope_idx ON organization_assignments(scope_kind,region_id,area_id,branch_id,ended_at);
CREATE INDEX organization_assignments_team_idx ON organization_assignments(team_id,ended_at);
CREATE UNIQUE INDEX organization_assignments_team_leader_key ON organization_assignments(team_id) WHERE ended_at IS NULL AND level='TEAM_LEADER';
-- No maximum number of Deputy Store Managers (or teams) is imposed.
CREATE UNIQUE INDEX organization_assignments_active_key ON organization_assignments(employee_user_id,level,scope_kind,
  COALESCE(region_id,'00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(area_id,'00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(branch_id,'00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(team_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE ended_at IS NULL;
CREATE TABLE team_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), team_id uuid NOT NULL REFERENCES teams(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  employee_user_id uuid NOT NULL REFERENCES employee_profiles(user_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  joined_at timestamptz(3) NOT NULL DEFAULT now(), ended_at timestamptz(3),
  assigned_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT team_memberships_dates CHECK(ended_at IS NULL OR ended_at>=joined_at),
  CONSTRAINT team_memberships_team_branch_fkey FOREIGN KEY(team_id,branch_id) REFERENCES teams(id,branch_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE UNIQUE INDEX team_memberships_active_employee_branch_key ON team_memberships(employee_user_id,branch_id) WHERE ended_at IS NULL;
CREATE INDEX team_memberships_team_active_idx ON team_memberships(team_id,ended_at,employee_user_id);
CREATE INDEX team_memberships_employee_active_idx ON team_memberships(employee_user_id,branch_id,ended_at);

-- Ending a relationship preserves every historical fact. Revoked relationships cannot reopen.
CREATE FUNCTION lucy_guard_organization_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Organization history cannot be deleted';
  END IF;
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL OR
    (to_jsonb(NEW)-'ended_at'-'row_version') IS DISTINCT FROM (to_jsonb(OLD)-'ended_at'-'row_version') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='End organization relationships without changing history';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_assignments_history BEFORE UPDATE OR DELETE ON organization_assignments FOR EACH ROW EXECUTE FUNCTION lucy_guard_organization_history();
CREATE TRIGGER team_memberships_history BEFORE UPDATE OR DELETE ON team_memberships FOR EACH ROW EXECUTE FUNCTION lucy_guard_organization_history();

CREATE FUNCTION lucy_check_organization_relationship() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM employee_branch_assignments e JOIN branches b ON b.id=e.branch_id
    WHERE e.employee_user_id=NEW.employee_user_id AND e.branch_id=NEW.branch_id AND e.revoked_at IS NULL AND b.is_active
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Active organization relationship requires active branch membership';
  END IF;
  IF NEW.team_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM teams WHERE id=NEW.team_id AND branch_id=NEW.branch_id AND is_active) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Active organization relationship requires an active team in the same branch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_assignments_valid BEFORE INSERT ON organization_assignments FOR EACH ROW EXECUTE FUNCTION lucy_check_organization_relationship();
CREATE TRIGGER team_memberships_valid BEFORE INSERT ON team_memberships FOR EACH ROW EXECUTE FUNCTION lucy_check_organization_relationship();

CREATE FUNCTION lucy_guard_team_relationships() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Team branch identity is immutable';
  END IF;
  IF NOT NEW.is_active AND (EXISTS(SELECT 1 FROM team_memberships WHERE team_id=NEW.id AND ended_at IS NULL)
    OR EXISTS(SELECT 1 FROM organization_assignments WHERE team_id=NEW.id AND ended_at IS NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='End active team relationships before deleting a team';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER teams_relationship_guard BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION lucy_guard_team_relationships();

-- Populate code-owned catalog entries only. No user is assigned a role or permission.
INSERT INTO permissions(id,code,scope_capability,data_classification)
SELECT gen_random_uuid(),code::"PermissionCode",'BRANCH_CAPABLE'::"ScopeCapability",'STANDARD'::"DataClassification"
FROM unnest(ARRAY['VIEW_ORGANIZATION','MANAGE_ORGANIZATION','MANAGE_ORG_ASSIGNMENTS','VIEW_TEAMS','MANAGE_TEAMS']) AS x(code)
ON CONFLICT(code) DO NOTHING;
