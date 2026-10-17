import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import {
  AuthCleanup,
  accountDeletionEmailBinding,
  openDeliveryPayload,
  parseAccountDeletionEmailEnvelope,
  type AuthTransactionRunner,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import type { LoginService } from '../auth/login.service.js';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { validVnMobile } from '../testing/phone.js';
import { DELETED_ACCOUNT_NAME } from './account-deletion.core.js';
import { AccountDeletionService } from './account-deletion.service.js';

const PASSWORD = 'a calm lotus evening 2026';

/**
 * Session 10 A2 against real PostgreSQL: the check lists what stops a deletion (an unpaid or a paid online order), the deletion erases
 * the account in place (database shape enforced by migration 20261216000000), a never-paid cancelled order loses the recipient's name
 * and phone while a paid one keeps them, every session ends, the email is sealed, and the audit row holds counts only. The password
 * proof itself is LoginService's (tested there); here it is a stand-in that answers like it. Every fixture rolls back.
 */
test(
  'Session 10 A2 customer account deletion; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      await k.open();
      const cream = await k.stocked('cream', 200_000, 40);
      const deliveryKey = randomBytes(32);
      const environment = {
        ...base.environment,
        auth: {
          ...base.environment.auth,
          deliveryActiveVersion: 1,
          deliveryKeys: new Map([[1, deliveryKey]]),
        },
      };
      // The proof answers like LoginService.proveCurrentPassword: the right password returns the stored credential evidence.
      const logins: Pick<LoginService, 'proveCurrentPassword'> = {
        proveCurrentPassword: async (token, password) => {
          const principal = await base.adapter.resolve(token);
          if (!principal?.userId) throw new AuthError('AUTHENTICATION_REQUIRED');
          if (password !== PASSWORD) throw new AuthError('AUTHENTICATION_FAILED');
          const user = await tx.user.findUniqueOrThrow({
            where: { id: principal.userId },
            select: {
              id: true,
              kind: true,
              status: true,
              fullName: true,
              preferredLocale: true,
              emailVerifiedAt: true,
              passwordHash: true,
              credentialVersion: true,
              authzVersion: true,
            },
          });
          return { userId: user.id, user, evidenceHash: user.passwordHash! };
        },
      };
      const deletion = new AccountDeletionService(environment, base.adapter, base.throttle, logins);
      const savepoint = async (work: () => Promise<unknown>) => {
        await tx.$executeRawUnsafe('SAVEPOINT a2_guard');
        try {
          await work();
          assert.fail('the database accepted it');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT a2_guard');
          assert.match(String(error), /23514|deleted|erased|contact|recipient|frozen/i);
        }
      };

      await suite.test(
        'an unfinished online order stops the deletion; nothing changes',
        async () => {
          const hoa = await k.member('hoa');
          const waiting = await k.order(hoa, [{ variantId: cream.variantId, quantity: 1 }]);
          const check = await deletion.check(hoa.token);
          assert.equal(check.canDelete, false);
          assert.deepEqual(
            check.blockers.orders.map((order) => [order.id, order.kind]),
            [[waiting.id, 'ONLINE_UNPAID']],
          );
          await fails(
            () => deletion.delete(hoa.token, PASSWORD, 'peer'),
            'ACCOUNT_DELETION_BLOCKED',
          );
          const row = await tx.user.findUniqueOrThrow({ where: { id: hoa.id } });
          assert.equal(row.status, 'ACTIVE');
          assert.equal(row.deletedAt, null);

          // Paid and not yet delivered: still blocked, as "in progress".
          await k.payViaWebhook(hoa, waiting);
          const paid = await deletion.check(hoa.token);
          assert.deepEqual(
            paid.blockers.orders.map((order) => order.kind),
            ['ONLINE_IN_PROGRESS'],
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the deletion erases the account in place, ends every session, seals the email and keeps history',
        async () => {
          const lan = await k.member('lan');
          const before = await tx.user.findUniqueOrThrow({ where: { id: lan.id } });
          // A never-paid order the customer cancelled, a saved address, a cart line, an inbox item, a second device.
          const unpaid = await k.order(lan, [{ variantId: cream.variantId, quantity: 1 }]);
          await k.ok(() => k.online.cancel(lan.token, unpaid.id));
          await tx.customerAddress.create({
            data: {
              userId: lan.id,
              recipientName: 'Nguyễn Thị Lan',
              recipientPhone: validVnMobile(),
              provinceCode: 'HA_NOI',
              ward: 'Phường Cửa Nam',
              street: '12 Phố Huế',
            },
          });
          await k.addToCart(lan, cream.variantId, 1);
          const secondDevice = await base.signIn(lan.id);

          // A wrong password changes nothing.
          await fails(() => deletion.delete(lan.token, 'not it', 'peer'), 'AUTHENTICATION_FAILED');
          const check = await deletion.check(lan.token);
          assert.equal(check.canDelete, true);
          assert.deepEqual(check.blockers, {
            combos: [],
            orders: [],
            atSpa: false,
            openReturns: 0,
          });

          await deletion.delete(lan.token, PASSWORD, 'peer', 'req-a2');

          const after = await tx.user.findUniqueOrThrow({
            where: { id: lan.id },
            include: { customerProfile: true },
          });
          assert.equal(after.fullName, DELETED_ACCOUNT_NAME);
          assert.equal(after.status, 'INACTIVE');
          assert.ok(after.deletedAt);
          for (const field of [
            'emailCanonical',
            'emailDelivery',
            'emailVerifiedAt',
            'phoneCanonical',
            'passwordHash',
          ] as const) {
            assert.equal(after[field], null, field);
          }
          assert.equal(after.credentialVersion, before.credentialVersion + 1);
          assert.equal(after.customerProfile?.dateOfBirth, null);
          assert.equal(after.customerProfile?.address, null);

          // Every session ended, on every device.
          assert.equal(await tx.session.count({ where: { userId: lan.id, revokedAt: null } }), 0);
          await fails(() => deletion.check(lan.token), 'AUTHENTICATION_REQUIRED');
          await fails(() => deletion.check(secondDevice), 'AUTHENTICATION_REQUIRED');

          // Saved addresses and the cart are gone; inbox items are archived.
          assert.equal(await tx.customerAddress.count({ where: { userId: lan.id } }), 0);
          assert.equal(await tx.onlineCart.count({ where: { userId: lan.id } }), 0);
          assert.equal(
            await tx.notification.count({ where: { recipientUserId: lan.id, archivedAt: null } }),
            0,
          );

          // The never-paid order lost the recipient's and contact's name and phone; the address and the order itself stay.
          const order = await tx.productOrder.findUniqueOrThrow({
            where: { id: unpaid.id },
            include: { onlineDetail: true, invoice: { select: { code: true, totalVnd: true } } },
          });
          assert.equal(
            order.customerUserId,
            lan.id,
            'the order keeps the (now nameless) account id',
          );
          assert.equal(order.contactPhone, null);
          assert.equal(order.contactName, null);
          assert.equal(order.onlineDetail?.recipientName, null);
          assert.equal(order.onlineDetail?.recipientPhone, null);
          assert.equal(order.onlineDetail?.street, '12 Phố Huế');
          assert.ok(order.invoice.totalVnd > 0n, 'the invoice keeps its own amount');

          // The sealed email opens to the old address; nothing in plaintext names the person.
          const email = await tx.accountDeletionEmail.findUniqueOrThrow({
            where: { userId: lan.id },
          });
          assert.equal(email.state, 'PENDING');
          const envelope = parseAccountDeletionEmailEnvelope(
            openDeliveryPayload(
              {
                ciphertext: Buffer.from(email.encryptedPayload!),
                nonce: Buffer.from(email.nonce!),
                tag: Buffer.from(email.tag!),
              },
              accountDeletionEmailBinding(email.id),
              deliveryKey,
            )!,
          );
          assert.equal(envelope?.to, before.emailDelivery);
          const event = await tx.outboxEvent.findFirstOrThrow({
            where: { aggregateType: 'AccountDeletionEmail', aggregateId: email.id },
          });
          const audit = await tx.auditEvent.findFirstOrThrow({
            where: { subjectUserId: lan.id, action: 'CUSTOMER_ACCOUNT_DELETED' },
          });
          assert.equal(audit.actorUserId, lan.id);
          assert.equal(audit.requestId, 'req-a2');
          assert.deepEqual(audit.after, {
            via: 'SELF_SERVICE',
            bookingsCancelled: 0,
            ordersErased: 1,
            addressesDeleted: 1,
            sessionsRevoked: 2,
            notificationsArchived: 0,
            emailQueued: true,
          });
          const plaintext = JSON.stringify([event.payload, audit.after, audit.before]);
          for (const secret of [before.emailCanonical!, before.phoneCanonical!, lan.fullName]) {
            assert.ok(
              !plaintext.includes(secret),
              'no personal data in the outbox or the audit row',
            );
          }

          // Never sent (no mail transport running) and past its deadline: the cleanup expires it and erases the sealed address.
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE account_deletion_emails SET created_at = clock_timestamp() - interval '2 days', next_attempt_at = clock_timestamp() - interval '2 days', expires_at = clock_timestamp() - interval '1 day' WHERE id = '${email.id}'::uuid`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = DEFAULT');
          const cleanup = await new AuthCleanup(base.adapter as AuthTransactionRunner).run({
            batchSize: 50,
            maxBatches: 2,
          });
          assert.ok(cleanup.expiredDeletionEmails >= 1);
          const expired = await tx.accountDeletionEmail.findUniqueOrThrow({
            where: { id: email.id },
          });
          assert.equal(expired.state, 'EXPIRED');
          assert.equal(expired.encryptedPayload, null);
          assert.equal(expired.keyVersion, null);

          // The address and the phone are free again: the person may register anew.
          const fresh = await tx.user.create({
            data: {
              kind: 'CUSTOMER',
              status: 'ACTIVE',
              fullName: 'Lan again',
              preferredLocale: 'vi',
              emailCanonical: before.emailCanonical,
              emailDelivery: before.emailDelivery,
              emailVerifiedAt: new Date(),
              phoneCanonical: before.phoneCanonical,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              customerProfile: {
                create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
              },
            },
            select: { id: true },
          });
          assert.notEqual(fresh.id, lan.id);

          // The database keeps a deleted account deleted and an erased contact erased.
          await savepoint(() =>
            tx.user.update({ where: { id: lan.id }, data: { phoneCanonical: validVnMobile() } }),
          );
          await savepoint(() =>
            tx.customerProfile.update({
              where: { userId: lan.id },
              data: { dateOfBirth: new Date('1990-01-01'), address: 'Back' },
            }),
          );
          await savepoint(() =>
            tx.productOrder.update({
              where: { id: unpaid.id },
              data: { contactPhone: validVnMobile() },
            }),
          );
          await k.reconcileAll();
        },
      );

      await suite.test(
        'the database refuses every other erasure and every fake deletion',
        async () => {
          const mai = await k.member('mai');
          const paid = await k.order(mai, [{ variantId: cream.variantId, quantity: 1 }]);
          await k.payViaWebhook(mai, paid);
          // A live customer cannot lose the profile, and a live account's order keeps its recipient.
          await savepoint(() =>
            tx.customerProfile.update({
              where: { userId: mai.id },
              data: { dateOfBirth: null, address: null },
            }),
          );
          await savepoint(() =>
            tx.onlineOrderDetail.update({
              where: { orderId: paid.id },
              data: { recipientName: null, recipientPhone: null },
            }),
          );
          // A deleted row needs the whole deleted shape (no phone, no password, the placeholder name).
          await savepoint(() =>
            tx.user.update({
              where: { id: mai.id },
              data: { status: 'INACTIVE', deletedAt: new Date() } as Prisma.UserUpdateInput,
            }),
          );
          // Even for a deleted account, a PAID order keeps the recipient (legal record, Owner answer 3).
          await tx.$executeRawUnsafe('SAVEPOINT a2_paid');
          await tx.user.update({
            where: { id: mai.id },
            data: {
              fullName: DELETED_ACCOUNT_NAME,
              emailCanonical: null,
              emailDelivery: null,
              emailVerifiedAt: null,
              phoneCanonical: null,
              passwordHash: null,
              status: 'INACTIVE',
              deletedAt: new Date(),
            },
          });
          await savepoint(() =>
            tx.onlineOrderDetail.update({
              where: { orderId: paid.id },
              data: { recipientName: null, recipientPhone: null },
            }),
          );
          await savepoint(() =>
            tx.productOrder.update({
              where: { id: paid.id },
              data: { contactPhone: null, contactName: null },
            }),
          );
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT a2_paid');
          // A deletion email is queued for a deleted account only.
          await savepoint(() =>
            tx.accountDeletionEmail.create({
              data: {
                userId: mai.id,
                encryptedPayload: new Uint8Array([1]),
                nonce: new Uint8Array(12),
                tag: new Uint8Array(16),
                keyVersion: 1,
                expiresAt: new Date(Date.now() + 60_000),
                nextAttemptAt: new Date(),
              },
            }),
          );
          // Staff sessions are refused.
          await fails(() => deletion.check(base.ownerToken), 'FORBIDDEN');
          await k.reconcileAll();
        },
      );
    });
  },
);
