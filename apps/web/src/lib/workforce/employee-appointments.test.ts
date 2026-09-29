import assert from 'node:assert/strict';
import test from 'node:test';
import { appointmentLabels, type AppointmentNames } from './employee-appointments';

const names: AppointmentNames = {
  levels: {
    CEO: 'CEO / Quản lý cấp cao',
    REGIONAL_MANAGER: 'Quản lý vùng',
    AREA_MANAGER: 'Quản lý khu vực',
    STORE_MANAGER: 'Quản lý cửa hàng',
    DEPUTY_STORE_MANAGER: 'Phó quản lý cửa hàng',
    TEAM_LEADER: 'Trưởng nhóm',
  },
  system: 'Toàn hệ thống',
  unknown: '—',
  region: (id) => (id === 'r1' ? 'Miền Nam' : undefined),
  area: (id) => (id === 'a1' ? 'Quận 1' : undefined),
  branch: (id) => (id === 'b1' ? 'Chi nhánh A' : undefined),
};

test('a system CEO appointment is shown with its level and scope', () => {
  assert.deepEqual(
    appointmentLabels(
      [{ id: '1', level: 'CEO', scope: { kind: 'GLOBAL' }, teamId: null, teamName: null }],
      names,
    ),
    ['CEO / Quản lý cấp cao · Toàn hệ thống'],
  );
});

test('several appointments are all kept in order; teams and unknown scopes are labelled honestly', () => {
  assert.deepEqual(
    appointmentLabels(
      [
        {
          id: '1',
          level: 'STORE_MANAGER',
          scope: { kind: 'BRANCH', branchId: 'b1' },
          teamId: null,
          teamName: null,
        },
        {
          id: '2',
          level: 'TEAM_LEADER',
          scope: { kind: 'BRANCH', branchId: 'b1' },
          teamId: 't',
          teamName: 'Nhóm 1',
        },
        {
          id: '3',
          level: 'AREA_MANAGER',
          scope: { kind: 'AREA', areaId: 'zzz' },
          teamId: null,
          teamName: null,
        },
      ],
      names,
    ),
    ['Quản lý cửa hàng · Chi nhánh A', 'Trưởng nhóm · Chi nhánh A (Nhóm 1)', 'Quản lý khu vực · —'],
  );
});

test('no appointment means no management label at all', () => {
  assert.deepEqual(appointmentLabels(undefined, names), []);
  assert.deepEqual(appointmentLabels([], names), []);
});
