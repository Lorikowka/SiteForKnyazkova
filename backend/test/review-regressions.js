import assert from 'node:assert/strict';
import { test, beforeEach, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

Object.assign(process.env, {
  NODE_ENV: 'test', SQLITE_PATH: ':memory:', LOG_LEVEL: 'silent', MOCK_MODE: 'true',
  API_KEY: 'review-admin', ADMIN_API_KEYS: 'review-admin', BOT_API_KEYS: 'review-bot',
  TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', VK_BOT_TOKEN: '',
  VK_NOTIFY_PEER_IDS: '', SMTP_USER: '', SMTP_PASS: '', SITE_URL: 'http://localhost:1488'
});
const { buildApp } = await import('../src/app.js');
const { default: db } = await import('../src/db/index.js');
const { default: config } = await import('../src/config/index.js');
const { syncPayment, reconcilePayments, applyProviderPayment } = await import('../src/services/paymentSync.js');
const { getSlotAvailability } = await import('../src/domain/slots.js');
const { validateProductionConfig } = await import('../src/config/production.js');
const { validatePublicBooking } = await import('../src/domain/bookingDate.js');
const { backupDatabase, restoreDatabase, verifyDatabase, pruneBackups } = await import('../src/lib/backups.js');
const { default: logger } = await import('../src/utils/logger.js');
const app = await buildApp();
const originalFetch = globalThis.fetch;
const base = {
  serviceId: 'consult-online', customerName: 'Review Client', customerPhone: '+79990000001',
  sessionDate: '2099-06-01', sessionTime: '10:00', sessionDatetime: '2099-06-01T10:00:00'
};
const inject = (url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const create = (overrides = {}) => inject('/api/payments/create-payment', { ...base, ...overrides });
const confirm = (payment, overrides = {}) => inject(`/api/payments/${payment.paymentId}/confirm-booking`, { token: payment.statusToken, ...overrides });
const admin = (overrides = {}) => inject('/api/sessions', {
  clientName: base.customerName, clientPhone: base.customerPhone,
  serviceId: base.serviceId, sessionDate: base.sessionDate, sessionTime: base.sessionTime, ...overrides
}, { 'x-api-key': 'review-admin' });
const remote = (payment, overrides = {}) => ({
  id: payment.provider_payment_id, status: 'succeeded', paid: true,
  amount: { value: Number(payment.amount).toFixed(2), currency: 'RUB' }, ...overrides
});
const respond = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function pendingPayment() {
  const result = (await create()).json();
  db.setPaymentProviderId(result.paymentId, 'provider-review');
  db.updatePaymentStatus(result.paymentId, 'pending');
  config.app.mockMode = false;
  config.yookassa.isConfigured = true;
  return db.getPayment(result.paymentId);
}
const webhook = payment => inject('/api/admin/webhook', {
  type: 'notification', event: 'payment.succeeded',
  object: { id: payment.provider_payment_id, status: 'succeeded', paid: true }
});

beforeEach(() => {
  db.deleteAllSessions(); db.deleteAllPayments(); db.run('DELETE FROM schedule_exceptions');
  config.app.mockMode = true; config.yookassa.isConfigured = false;
  config.schedule.daysAhead = 36500; config.schedule.excludeWeekends = false;
  globalThis.fetch = async () => { throw new Error('Unexpected external request in test'); };
});
after(async () => { globalThis.fetch = originalFetch; await app.close(); db.close(); });

test('confirmation cannot replace the paid service, contact or slot', async () => {
  const payment = (await create({ serviceId: 'group-online' })).json();
  const response = await confirm(payment, { serviceId: 'consult-online', customerPhone: '+79991111111', sessionDate: '2099-06-20', sessionTime: '19:00' });
  assert.equal(response.statusCode, 200);
  const [session] = db.getSessionsByPaymentId(payment.paymentId);
  assert.equal(session.service_id, 'group-online'); assert.equal(session.amount, 1000);
  assert.equal(session.amount_minor, 100000);
  assert.equal(db.getPayment(payment.paymentId).amount_minor, 100000);
  assert.equal(session.client_phone, base.customerPhone); assert.equal(session.session_datetime, base.sessionDatetime);
});

test('structured person name is persisted while legacy full name stays compatible', async () => {
  const response = await create({
    customerName: undefined,
    customerLastName: 'Иванова', customerFirstName: 'Мария', customerMiddleName: 'Петровна'
  });
  assert.equal(response.statusCode, 200);
  const created = response.json();
  const payment = db.getPayment(created.paymentId);
  assert.equal(payment.customer_name, 'Иванова Мария Петровна');
  assert.equal(payment.customer_last_name, 'Иванова');
  assert.equal(payment.customer_first_name, 'Мария');
  assert.equal(payment.customer_middle_name, 'Петровна');
  assert.equal((await confirm(created)).statusCode, 200);
  const [session] = db.getSessionsByPaymentId(created.paymentId);
  assert.equal(session.client_name, 'Иванова Мария Петровна');
  assert.equal(session.client_last_name, 'Иванова');
  assert.equal(session.client_first_name, 'Мария');
  assert.equal(session.client_middle_name, 'Петровна');
});

test('invalid or conflicting dates are rejected before taking payment', async () => {
  for (const changes of [{ sessionDate: '2099-02-30' }, { sessionTime: '25:00' }, { sessionDatetime: '2099-06-02T10:00:00' }, { customerPhone: '' }, { serviceId: 'unknown' }]) {
    assert.equal((await create(changes)).statusCode, 400);
  }
  assert.equal(db.countPayments(), 0);
});

test('missing provider configuration does not reserve a slot', async () => {
  config.app.mockMode = false;
  assert.equal((await create()).statusCode, 503);
  assert.equal(db.countPayments(), 0);
  config.app.mockMode = true;
  assert.equal((await create()).statusCode, 200);
});

test('definitive provider rejection releases the slot', async () => {
  config.app.mockMode = false; config.yookassa.isConfigured = true;
  globalThis.fetch = async () => respond({ type: 'error', code: 'invalid_request' }, 400);
  assert.equal((await create()).statusCode, 503);
  assert.equal(db.getAllPayments()[0].status, 'failed');
  config.app.mockMode = true;
  assert.equal((await create()).statusCode, 200);
});

test('unknown creation outcome is retried with identical body and idempotence key', async () => {
  config.app.mockMode = false; config.yookassa.isConfigured = true;
  let first;
  globalThis.fetch = async (_url, options) => { first = options; throw new Error('Connection lost'); };
  assert.equal((await create()).statusCode, 503);
  const payment = db.getAllPayments()[0];
  assert.equal(payment.status, 'pending');
  assert.equal(getSlotAvailability(base).available, false);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.body, first.body);
    assert.equal(options.headers['Idempotence-Key'], first.headers['Idempotence-Key']);
    return respond(remote(payment, { id: 'recovered-provider-id' }));
  };
  await syncPayment(payment);
  assert.equal(db.getPayment(payment.id).status, 'succeeded');
  assert.equal(db.getSessionsByPaymentId(payment.id).length, 1);
});

test('unknown outcomes older than the idempotency window are never recreated', async () => {
  const payment = (await create()).json();
  db.run("UPDATE payments SET status = 'pending', created_at = datetime('now', '-25 hours') WHERE id = ?", [payment.paymentId]);
  config.app.mockMode = false; config.yookassa.isConfigured = true;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Must not request creation'); };
  await assert.rejects(syncPayment(db.getPayment(payment.paymentId)), /manual provider reconciliation/);
  assert.equal(calls, 0); assert.equal(getSlotAvailability(base).available, false);
});

test('unsigned provider notification creates exactly one booking without browser return', async () => {
  const payment = await pendingPayment();
  globalThis.fetch = async (url, options) => {
    assert.ok(url.endsWith('/payments/provider-review'));
    assert.ok(options.headers.Authorization.startsWith('Basic '));
    return respond(remote(payment));
  };
  const responses = await Promise.all([webhook(payment), webhook(payment)]);
  assert.ok(responses.every(r => r.statusCode === 200));
  assert.equal(db.getSessionsByPaymentId(payment.id).length, 1);
  assert.equal(db.getPayment(payment.id).status, 'succeeded');
});

test('forged success notification cannot override provider pending status', async () => {
  const payment = await pendingPayment();
  globalThis.fetch = async () => respond(remote(payment, { status: 'pending', paid: false }));
  assert.equal((await webhook(payment)).statusCode, 200);
  assert.equal(db.getPayment(payment.id).status, 'pending');
  assert.equal(db.getSessionsByPaymentId(payment.id).length, 0);
});

test('wrong provider identity, amount or currency never confirms a booking', async () => {
  const payment = await pendingPayment();
  for (const overrides of [{ id: 'other' }, { amount: { value: '1.00', currency: 'RUB' } }, { amount: { value: '3000.00', currency: 'USD' } }]) {
    globalThis.fetch = async () => respond(remote(payment, overrides));
    assert.equal((await webhook(payment)).statusCode, 503);
    assert.equal(db.getPayment(payment.id).status, 'pending');
    assert.equal(db.getSessionsByPaymentId(payment.id).length, 0);
  }
});

test('provider outage requests webhook redelivery without changing state', async () => {
  const payment = await pendingPayment();
  globalThis.fetch = async () => respond({ type: 'error' }, 500);
  assert.equal((await webhook(payment)).statusCode, 503);
  assert.equal(db.getPayment(payment.id).status, 'pending');
});

test('background reconciliation releases provider-canceled reservations', async () => {
  const payment = await pendingPayment();
  db.run("UPDATE payments SET created_at = datetime('now', '-2 minutes') WHERE id = ?", [payment.id]);
  globalThis.fetch = async () => respond(remote(payment, { status: 'canceled', paid: false }));
  await reconcilePayments();
  assert.equal(db.getPayment(payment.id).status, 'canceled');
  assert.equal(getSlotAvailability(base).available, true);
});

test('background reconciliation confirms successful payment without webhook', async () => {
  const payment = await pendingPayment();
  db.run("UPDATE payments SET created_at = datetime('now', '-2 minutes') WHERE id = ?", [payment.id]);
  globalThis.fetch = async () => respond(remote(payment));
  await reconcilePayments(); await reconcilePayments();
  assert.equal(db.getSessionsByPaymentId(payment.id).length, 1);
});

test('late canceled response cannot roll back a successful payment', async () => {
  const payment = await pendingPayment();
  await applyProviderPayment(payment, remote(payment));
  await applyProviderPayment(payment, remote(payment, { status: 'canceled', paid: false }));
  assert.equal(db.getPayment(payment.id).status, 'succeeded');
  const transitions = db.all('SELECT old_status, new_status FROM payment_events WHERE payment_id = ? AND event_type = ?', [payment.id, 'status_changed']);
  assert.ok(transitions.some(event => event.new_status === 'succeeded'));
  assert.ok(!transitions.some(event => event.old_status === 'succeeded' && event.new_status === 'canceled'));
});

test('waiting for capture alone is not a completed payment', async () => {
  const payment = await pendingPayment();
  await applyProviderPayment(payment, remote(payment, { status: 'waiting_for_capture' }));
  assert.equal(db.getSessionsByPaymentId(payment.id).length, 0);
});

test('admin cannot overlay a group on an individual session or payment reserve', async () => {
  assert.equal((await admin()).statusCode, 201);
  assert.equal((await admin({ serviceId: 'group-online', clientPhone: '+79990000002' })).statusCode, 409);
  db.deleteAllSessions();
  await create();
  assert.equal((await admin({ serviceId: 'group-online', clientPhone: '+79990000002' })).statusCode, 409);
});

test('admin cannot take reserved group capacity or overlay an individual on a group', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await create({ serviceId: 'group-online', customerPhone: `+799900000${10 + i}` })).statusCode, 200);
  }
  assert.equal((await admin({ serviceId: 'group-online' })).statusCode, 409);
  assert.equal((await admin()).statusCode, 409);
});

test('past and reminder filters compare dates chronologically', () => {
  const ids = {};
  for (const [key, modifier] of Object.entries({ past: '-1 minutes', near: '+1 minutes', inside: '+47 hours', outside: '+49 hours' })) {
    const { dt } = db.get("SELECT strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime', ?) AS dt", [modifier]);
    const result = db.createSession({ payment_id: null, client_name: key, client_phone: key,
      service_id: 'consult-online', service_name: 'Review', session_date: dt.slice(0, 10),
      session_time: dt.slice(11, 16), session_datetime: dt, amount: 3000 });
    ids[key] = Number(result.lastInsertRowid);
  }
  const past = db.getPastSessions().map(s => s.id);
  assert.ok(past.includes(ids.past)); assert.ok(!past.includes(ids.near));
  const future = db.getSessionsByRange({ past: false }).map(s => s.id);
  assert.ok(!future.includes(ids.past)); assert.ok(future.includes(ids.near));
  const reminders = db.getSessionsForReminder().map(s => s.id);
  assert.ok(!reminders.includes(ids.past)); assert.ok(reminders.includes(ids.near));
  assert.ok(reminders.includes(ids.inside)); assert.ok(!reminders.includes(ids.outside));
});

test('bot key cannot delete payments or clear the database', async () => {
  const payment = (await create()).json();
  const headers = { 'x-bot-api-key': 'review-bot' };
  assert.equal((await inject('/api/admin/database/cleanup', { scope: 'all', confirm: 'DELETE_ALL' }, headers)).statusCode, 403);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/payments/${payment.paymentId}`, headers })).statusCode, 403);
  assert.ok(db.getPayment(payment.paymentId));
  assert.equal((await app.inject({ url: '/api/sessions', headers })).statusCode, 200);
});

test('production disables destructive financial endpoints even for administrators', async () => {
  const payment = (await create()).json();
  const original = config.app.nodeEnv;
  config.app.nodeEnv = 'production';
  try {
    const headers = { 'x-api-key': 'review-admin' };
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/payments/${payment.paymentId}`, headers })).statusCode, 403);
    assert.equal((await inject('/api/admin/database/cleanup', { paymentId: payment.paymentId }, headers)).statusCode, 403);
    assert.ok(db.getPayment(payment.paymentId));
  } finally { config.app.nodeEnv = original; }
});

test('admin payment listing never exposes browser capability tokens', async () => {
  const created = (await create()).json();
  const stored = db.getPayment(created.paymentId);
  db.run('UPDATE payments SET metadata = ? WHERE id = ?', [JSON.stringify({ ...JSON.parse(stored.metadata), internalSecret: 'must-not-leak' }), created.paymentId]);
  const response = await app.inject({ url: '/api/payments', headers: { 'x-api-key': 'review-admin' } });
  assert.equal(response.statusCode, 200);
  const [payment] = response.json().payments;
  assert.equal(payment.id, created.paymentId);
  assert.equal(payment.metadata.sessionDate, base.sessionDate);
  for (const secret of ['statusToken', 'cancelToken', 'returnUrl', 'orderId']) assert.equal(secret in payment.metadata, false);
  assert.equal('internalSecret' in payment.metadata, false);
  assert.equal('order_id' in payment, false);
  assert.ok(!response.body.includes(created.statusToken));
});

test('public health exposes only availability information', async () => {
  const response = await app.inject({ url: '/api/health' });
  assert.equal(response.statusCode, 200);
  const health = response.json();
  assert.equal(health.status, 'ok');
  for (const field of ['version', 'environment', 'payment_mode']) assert.equal(field in health, false);
});

test('operational monitoring is admin-only and exposes no customer data', async () => {
  const payment = (await create()).json();
  db.run("UPDATE payments SET status = 'pending', created_at = datetime('now', '-1 hours') WHERE id = ?", [payment.paymentId]);
  assert.equal((await app.inject({ url: '/api/admin/operations' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/admin/operations', headers: { 'x-bot-api-key': 'review-bot' } })).statusCode, 403);
  const result = await app.inject({ url: '/api/admin/operations', headers: { 'x-api-key': 'review-admin' } });
  assert.equal(result.statusCode, 200); assert.equal(result.json().stalePending, 1);
  assert.equal(result.json().needsAttention, true);
  assert.ok(!result.body.includes(base.customerPhone)); assert.ok(!result.body.includes(payment.statusToken));
});

test('reactivation cannot overbook an occupied slot', async () => {
  const first = (await admin({ serviceId: 'group-online' })).json();
  db.updateSessionStatus(first.sessionId, 'cancelled');
  assert.equal((await admin({ clientPhone: '+79990000002' })).statusCode, 201);
  const result = await app.inject({ method: 'PATCH', url: `/api/sessions/${first.sessionId}/status`,
    headers: { 'x-api-key': 'review-admin' }, payload: { status: 'scheduled' } });
  assert.equal(result.statusCode, 409);
  assert.equal(db.getSession(first.sessionId).status, 'cancelled');
});

test('reactivation of a free slot succeeds and blocked dates fail', async () => {
  const first = (await admin()).json();
  const status = () => app.inject({ method: 'PATCH', url: `/api/sessions/${first.sessionId}/status`,
    headers: { 'x-api-key': 'review-admin' }, payload: { status: 'scheduled' } });
  db.updateSessionStatus(first.sessionId, 'cancelled');
  db.markReminderSent(first.sessionId);
  assert.equal((await status()).statusCode, 200);
  assert.equal(db.getSession(first.sessionId).reminder_sent, 0);
  db.updateSessionStatus(first.sessionId, 'cancelled');
  db.blockDate(base.sessionDate, 'closed');
  assert.equal((await status()).statusCode, 409);
});

test('public booking enforces calendar horizon, working days and slots', async () => {
  const policy = { now: new Date(2026, 9, 21, 12), schedule: { daysAhead: 7, excludeWeekends: true, timeSlots: ['10:00'] } };
  assert.doesNotThrow(() => validatePublicBooking('2026-10-22', '10:00', policy));
  for (const [date, time] of [['2026-10-20', '10:00'], ['2026-10-21', '10:00'], ['2026-10-24', '10:00'], ['2026-10-29', '10:00'], ['2026-10-22', '03:00']]) {
    assert.throws(() => validatePublicBooking(date, time, policy), { code: 'invalid_booking_slot' });
  }
  config.schedule.daysAhead = 45;
  assert.equal((await create()).statusCode, 400);
  assert.equal(db.countPayments(), 0);
});

test('negative pagination cannot dump an unbounded result set', async () => {
  for (const url of ['/api/sessions?limit=-1', '/api/payments?limit=-1']) {
    const response = await app.inject({ url, headers: { 'x-api-key': 'review-admin' } });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().pagination.limit, 1);
  }
});

test('API logs do not contain query tokens', async () => {
  const messages = [];
  const originals = { info: logger.info, warn: logger.warn, error: logger.error };
  for (const level of Object.keys(originals)) logger[level] = (...args) => messages.push(JSON.stringify(args));
  try {
    await app.inject({ url: '/api/sessions?token=secret-review-token' });
    assert.ok(messages.length > 0);
    assert.ok(messages.every(line => !line.includes('secret-review-token')));
  } finally { Object.assign(logger, originals); }
});

test('forwarded IPs are ignored unless a trusted proxy address is configured', async () => {
  const original = config.app.trustedProxies;
  try {
    for (const [hops, expected] of [[[], '127.0.0.1'], [['127.0.0.1'], '203.0.113.2']]) {
      config.app.trustedProxies = hops;
      const instance = await buildApp();
      instance.get('/inspect-ip', async request => ({ ip: request.ip }));
      try {
        const response = await instance.inject({ url: '/inspect-ip', headers: { 'x-forwarded-for': '198.51.100.1, 203.0.113.2' } });
        assert.equal(response.json().ip, expected);
      } finally { await instance.close(); }
    }
  } finally { config.app.trustedProxies = original; }
});

test('production refuses unsafe config without exposing secret values', () => {
  const valid = { NODE_ENV: 'production', SITE_URL: 'https://example.com', MOCK_MODE: 'false',
    YOOKASSA_SHOP_ID: 'test-shop', YOOKASSA_SECRET_KEY: 'private-test-secret',
    ADMIN_API_KEYS: 'a'.repeat(64), BOT_API_KEYS: 'b'.repeat(64) };
  assert.doesNotThrow(() => validateProductionConfig(valid));
  for (const overrides of [{ SITE_URL: 'http://example.com' }, { MOCK_MODE: 'true' }, { ADMIN_API_KEYS: 'short' },
    { BOT_API_KEYS: valid.ADMIN_API_KEYS }, { YOOKASSA_SECRET_KEY: '' }, { VERCEL: '1' }, { SQLITE_PATH: ':memory:' }]) {
    assert.throws(() => validateProductionConfig({ ...valid, ...overrides }), error => {
      assert.ok(!error.message.includes('private-test-secret')); return true;
    });
  }
});

test('online backup includes WAL data and restores into a verified new database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-backup-test-'));
  const source = path.join(dir, 'source.db'), backup = path.join(dir, 'snapshot.db'), restored = path.join(dir, 'restored.db');
  fs.writeFileSync(source, db.db.serialize());
  const writer = new Database(source);
  try {
    writer.pragma('journal_mode = WAL');
    writer.prepare("INSERT INTO payments (id, order_id, amount) VALUES ('wal-payment', 'wal-order', 3000)").run();
    assert.ok(fs.statSync(`${source}-wal`).size > 0);
    const result = await backupDatabase(source, backup);
    assert.equal(result.payments, 1);
    await restoreDatabase(backup, restored);
    assert.deepEqual(verifyDatabase(restored), { payments: 1, sessions: 0 });
    const reader = new Database(restored, { readonly: true });
    try { assert.equal(reader.prepare('SELECT id FROM payments').get().id, 'wal-payment'); }
    finally { reader.close(); }
    await assert.rejects(restoreDatabase(backup, source), /already exist/);
    await assert.rejects(backupDatabase(source, backup), /new file/);
    const broken = path.join(dir, 'broken.db'); fs.writeFileSync(broken, 'not a database');
    await assert.rejects(restoreDatabase(broken, path.join(dir, 'invalid-restore.db')));
    assert.equal(fs.existsSync(path.join(dir, 'invalid-restore.db')), false);
  } finally {
    writer.close();
    // Only this test's uniquely created temp files are removed.
    for (const entry of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, entry));
    fs.rmdirSync(dir);
  }
});

test('backup retention removes only old application snapshots', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-prune-test-'));
  const oldBackup = 'payments-2026-01-01T00-00-00-000Z-123e4567-e89b-12d3-a456-426614174000.db';
  const recentBackup = 'payments-2026-01-02T00-00-00-000Z-123e4567-e89b-12d3-a456-426614174001.db';
  const unrelated = 'customer-export.db';
  try {
    for (const name of [oldBackup, recentBackup, unrelated]) fs.writeFileSync(path.join(dir, name), 'test');
    const now = Date.UTC(2026, 0, 3);
    fs.utimesSync(path.join(dir, oldBackup), new Date(now - 3 * 86400000), new Date(now - 3 * 86400000));
    fs.utimesSync(path.join(dir, recentBackup), new Date(now), new Date(now));
    fs.utimesSync(path.join(dir, unrelated), new Date(now - 3 * 86400000), new Date(now - 3 * 86400000));
    assert.equal(pruneBackups(dir, 1, now), 1);
    assert.equal(fs.existsSync(path.join(dir, oldBackup)), false);
    assert.equal(fs.existsSync(path.join(dir, recentBackup)), true);
    assert.equal(fs.existsSync(path.join(dir, unrelated)), true);
  } finally {
    for (const entry of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, entry));
    fs.rmdirSync(dir);
  }
});
