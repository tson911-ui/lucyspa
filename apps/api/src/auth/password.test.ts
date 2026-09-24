import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import type { DatabaseClient, Prisma } from '@lucy-spa/database';
import * as argon2 from 'argon2';
import {
  normalizePassword,
  PASSWORD_HASH_PARAMETERS,
  PasswordPolicyError,
  PasswordService,
  PasswordWorkLimitError,
  validatePasswordForSetting,
} from './password.service.js';

const passphrase = 'Mưa trên phố nhỏ tháng chín';

test('password policy counts NFC Unicode code points without trimming or changing case', () => {
  assert.equal(normalizePassword('e\u0301'.repeat(15)), 'é'.repeat(15));
  assert.equal(normalizePassword('🌺'.repeat(15)), '🌺'.repeat(15));
  assert.equal(normalizePassword('🌺'.repeat(128)), '🌺'.repeat(128));
  assert.equal(normalizePassword('  Giữ Nguyên 15  '), '  Giữ Nguyên 15  ');
  assert.equal(validatePasswordForSetting(passphrase), passphrase);
  for (const input of ['a'.repeat(14), 'a'.repeat(129), 'e\u0301'.repeat(14), '🌺'.repeat(129)]) {
    assert.throws(
      () => normalizePassword(input),
      (error: unknown) => error instanceof PasswordPolicyError && error.code === 'PASSWORD_LENGTH',
    );
  }
  for (const input of [
    null,
    123,
    {},
    'a'.repeat(1_025),
    `bad\ud800${passphrase}`,
    `bad\udc00${passphrase}`,
  ]) {
    assert.throws(() => normalizePassword(input), PasswordPolicyError);
  }
});

test('setting policy checks the local compromised blocklist and errors do not expose input', () => {
  const common = '123456789987654321';
  assert.equal(normalizePassword(common), common);
  assert.throws(
    () => validatePasswordForSetting(common),
    (error: unknown) => {
      assert.ok(error instanceof PasswordPolicyError);
      assert.equal(error.code, 'PASSWORD_COMPROMISED');
      assert.equal(String(error).includes(common), false);
      assert.equal(JSON.stringify(error).includes(common), false);
      return true;
    },
  );
});

test('Argon2id produces unique PHC salts at the approved target and verifies NFC consistently', async (context) => {
  const service = new PasswordService();
  const durations: number[] = [];
  const hashes: string[] = [];
  for (let sample = 0; sample < 3; sample += 1) {
    const start = performance.now();
    hashes.push(await service.hashForSetting(passphrase.normalize('NFD')));
    durations.push(performance.now() - start);
  }
  context.diagnostic(
    `Argon2id 64MiB/t3/p1 sequential hash samples ms: ${durations.map((value) => value.toFixed(1)).join(', ')}`,
  );
  assert.equal(new Set(hashes).size, 3);
  for (const encoded of hashes) {
    assert.match(encoded, /^\$argon2id\$v=19\$/);
    const parts = encoded.split('$');
    assert.deepEqual(parts[3]?.split(',').sort(), ['m=65536', 'p=1', 't=3']);
    assert.equal(Buffer.from(parts[4] ?? '', 'base64').length, 16);
    assert.equal(Buffer.from(parts[5] ?? '', 'base64').length, 32);
    assert.equal(service.needsRehash(encoded), false);
  }
  const encoded = hashes[0];
  assert.ok(encoded);
  assert.deepEqual(await service.verify(passphrase, encoded), {
    verified: true,
    needsRehash: false,
  });
  assert.deepEqual(await service.verify(passphrase.normalize('NFD'), encoded), {
    verified: true,
    needsRehash: false,
  });
  for (const input of [passphrase.toUpperCase(), ` ${passphrase}`, `${passphrase} `, 'short']) {
    assert.deepEqual(await service.verify(input, encoded), { verified: false, needsRehash: false });
  }
});

test('verification rejects malformed, wrong-algorithm, unsupported and excessive-cost PHC', async () => {
  const service = new PasswordService();
  const salt = Buffer.alloc(16, 1).toString('base64').replace(/=+$/, '');
  const hash = Buffer.alloc(32, 2).toString('base64').replace(/=+$/, '');
  for (const encoded of [
    'private hash malformed',
    '',
    'x'.repeat(513),
    `$argon2i$v=19$m=65536,t=3,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=999999,t=3,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=65536,t=99,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=65536,t=3,p=99$${salt}$${hash}`,
    `$argon2id$v=19$m=65536,m=65536,t=3$${salt}$${hash}`,
    `$argon2id$v=19$m=65536,t=3$${salt}$${hash}`,
    `$argon2id$v=19$m=1024,t=1,p=1$${salt}$${hash}`,
    `$argon2id$v=19$m=65536,t=3,p=1$${salt}=$${hash}`,
  ]) {
    assert.deepEqual(await service.verify(passphrase, encoded), {
      verified: false,
      needsRehash: false,
    });
    assert.equal(service.needsRehash(encoded), true);
  }
});

test('hashing and verification share bounded work slots and reject queue overflow', async () => {
  const service = new PasswordService({ maxConcurrent: 1, maxQueued: 1 });
  const first = service.hashForSetting(passphrase);
  const second = service.hashForSetting(`${passphrase} nữa`);
  await assert.rejects(service.hashForSetting(`${passphrase} khác`), PasswordWorkLimitError);
  const [hash] = await Promise.all([first, second]);
  assert.ok(hash);
  const busy = new PasswordService({ maxConcurrent: 1, maxQueued: 0 });
  const work = busy.hashForSetting(passphrase);
  await assert.rejects(busy.verify(passphrase, hash), PasswordWorkLimitError);
  await work;
  assert.equal((await busy.verify(passphrase, hash)).verified, true);
  for (const options of [
    { maxConcurrent: 0 },
    { maxConcurrent: 9 },
    { maxConcurrent: 1.5 },
    { maxQueued: -1 },
    { maxQueued: 129 },
  ]) {
    assert.throws(() => new PasswordService(options), /Invalid password work limits/);
  }
});

function fakeDatabase(
  updateMany: (args: Prisma.UserUpdateManyArgs) => Promise<{ count: number }>,
): Pick<DatabaseClient, 'user'> {
  return { user: { updateMany } } as unknown as Pick<DatabaseClient, 'user'>;
}

test('successful legacy verification rehashes through an old-hash/version compare-and-update', async () => {
  const service = new PasswordService();
  const oldHash = await argon2.hash(passphrase, {
    ...PASSWORD_HASH_PARAMETERS,
    memoryCost: 19_456,
    timeCost: 2,
  });
  assert.deepEqual(await service.verify(passphrase, oldHash), {
    verified: true,
    needsRehash: true,
  });
  let replacement = '';
  const snapshot = {
    userId: '00000000-0000-0000-0000-000000000001',
    passwordHash: oldHash,
    credentialVersion: 7,
  };
  const database = fakeDatabase(async (args) => {
    assert.deepEqual(args.where, {
      id: snapshot.userId,
      passwordHash: oldHash,
      credentialVersion: 7,
    });
    assert.deepEqual(Object.keys(args.data), ['passwordHash']);
    assert.equal(typeof args.data.passwordHash, 'string');
    replacement = args.data.passwordHash as string;
    return { count: 1 };
  });
  assert.deepEqual(await service.verifyAndRehash(passphrase, snapshot, database), {
    verified: true,
    needsRehash: false,
    rehash: 'updated',
  });
  assert.notEqual(replacement, oldHash);
  assert.equal((await service.verify(passphrase, replacement)).verified, true);
  const raced = fakeDatabase(async () => ({ count: 0 }));
  assert.deepEqual(await service.verifyAndRehash(passphrase, snapshot, raced), {
    verified: false,
    needsRehash: false,
    rehash: 'stale',
  });
  const noWrite = fakeDatabase(async () => {
    throw new Error('Must not write on a mismatch or a current hash.');
  });
  assert.equal(
    (await service.verifyAndRehash(`${passphrase} sai`, snapshot, noWrite)).rehash,
    'not-verified',
  );
  assert.equal(
    (await service.verifyAndRehash(passphrase, { ...snapshot, passwordHash: replacement }, noWrite))
      .rehash,
    'not-needed',
  );
});

test('rehash preserves stronger costs and does not apply the set/reset blocklist at login', async () => {
  const service = new PasswordService();
  const common = '123456789987654321';
  const oldHash = await argon2.hash(common, {
    ...PASSWORD_HASH_PARAMETERS,
    memoryCost: 131_072,
    timeCost: 4,
    salt: Buffer.alloc(8, 3),
  });
  let replacement = '';
  const database = fakeDatabase(async (args) => {
    replacement = args.data.passwordHash as string;
    return { count: 1 };
  });
  const result = await service.verifyAndRehash(
    common,
    { userId: 'fixture', passwordHash: oldHash, credentialVersion: 1 },
    database,
  );
  assert.equal(result.rehash, 'updated');
  assert.deepEqual(replacement.split('$')[3]?.split(',').sort(), ['m=131072', 'p=1', 't=4']);
  assert.equal(service.needsRehash(replacement), false);
  await assert.rejects(service.hashForSetting(common), PasswordPolicyError);
});
