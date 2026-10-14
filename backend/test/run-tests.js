/**
 * Интеграционные тесты backend.
 *
 * Запуск: npm test
 * Тесты работают с временной базой данных (SQLITE_PATH), поэтому не затрагивают
 * рабочую data/payments.db.
 */

const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `psixolog-test-${Date.now()}.db`);

process.env.NODE_ENV = 'test';
process.env.SQLITE_PATH = TEST_DB;
process.env.API_KEY = 'test-admin-key';
process.env.ADMIN_API_KEYS = 'test-admin-key';
process.env.BOT_API_KEYS = 'test-bot-key';
process.env.MOCK_MODE = 'true';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
process.env.VK_BOT_TOKEN = '';
process.env.VK_NOTIFY_PEER_IDS = '';
process.env.SITE_URL = 'http://localhost:1488';

const app = require('../server');
const db = require('../database');
const { buildVkEventMessage } = require('../lib/vkNotifier');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const ADMIN_HEADERS = { 'Content-Type': 'application/json', 'X-API-Key': 'test-admin-key' };

let server;
let baseUrl;

function request(method, url, { body, headers } = {}) {
  return fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function createMockPayment(overrides = {}) {
  const payload = {
    amount: 3500,
    description: 'Индивидуальная консультация',
    customerEmail: 'client@example.com',
    customerName: 'Тестовый Клиент',
    customerPhone: '+79990000000',
    serviceId: 'consult',
    serviceName: 'Индивидуальная консультация',
    sessionDate: '2099-06-01',
    sessionTime: '10:00',
    sessionDatetime: '2099-06-01T10:00:00',
    ...overrides
  };
  const response = await request('POST', '/api/payments/create-payment', { body: payload });
  return { response, payload, body: await response.json() };
}

function bookingPayload(payment, overrides = {}) {
  return {
    token: payment.statusToken,
    customerName: 'Тестовый Клиент',
    customerPhone: '+79990000000',
    customerEmail: 'client@example.com',
    serviceId: 'consult',
    serviceName: 'Индивидуальная консультация',
    sessionDate: '2099-06-01',
    sessionTime: '10:00',
    sessionDatetime: '2099-06-01T10:00:00',
    ...overrides
  };
}

// —————————————————————————————— ТЕСТЫ ——————————————————————————————

test('health endpoint returns service status', async () => {
  const response = await request('GET', '/api/health');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'psixolog-payment-backend');
  assert.equal(body.database, 'ok');
});

test('services endpoint returns catalogue and schedule', async () => {
  const response = await request('GET', '/api/services');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.services));
  assert.ok(body.services.length > 0);
  assert.ok(Array.isArray(body.schedule.timeSlots));
});

test('reviews endpoint stores a site review', async () => {
  const response = await request('POST', '/api/reviews', {
    body: {
      rating: 5,
      name: 'Test User',
      contact: '+7 999 000-00-00',
      message: 'The consultation was helpful and comfortable.'
    }
  });
  const body = await response.json();
  const rows = await db.getAllReviews(1);

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(rows[0].id, body.id);
  assert.equal(rows[0].rating, 5);
});

test('reviews endpoint validates input', async () => {
  const response = await request('POST', '/api/reviews', {
    body: { rating: 9, name: 'x', contact: 'y', message: 'short' }
  });
  assert.equal(response.status, 400);
});

test('admin sessions endpoint requires an API key', async () => {
  const response = await request('GET', '/api/sessions');
  assert.equal(response.status, 401);
});

test('bot API key can access filtered sessions endpoint', async () => {
  const response = await request('GET', '/api/sessions?from=2099-01-01T00:00:00&to=2099-01-02T00:00:00', {
    headers: { 'X-Bot-API-Key': 'test-bot-key' }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.sessions));
});

test('unknown API route returns JSON 404', async () => {
  const response = await request('GET', '/api/does-not-exist');
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
});

test('mock payment can be created and read back', async () => {
  const { response, body } = await createMockPayment();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.ok(body.paymentId);
  assert.ok(body.statusToken);

  const details = await request('GET', `/api/payments/${body.paymentId}?token=${body.statusToken}`);
  const detailsBody = await details.json();
  assert.equal(details.status, 200);
  assert.equal(detailsBody.payment.status, 'succeeded');
});

test('payment details require a valid token', async () => {
  const { body } = await createMockPayment({
    sessionDate: '2099-06-01',
    sessionTime: '11:30',
    sessionDatetime: '2099-06-01T11:30:00'
  });
  const response = await request('GET', `/api/payments/${body.paymentId}?token=wrong`);
  assert.equal(response.status, 403);
});

test('confirm-booking creates a session and is idempotent', async () => {
  const { body: payment } = await createMockPayment({
    sessionDate: '2099-06-02',
    sessionTime: '11:30',
    sessionDatetime: '2099-06-02T11:30:00'
  });

  const first = await request('POST', `/api/payments/${payment.paymentId}/confirm-booking`, {
    body: bookingPayload(payment, { sessionDate: '2099-06-02', sessionTime: '11:30', sessionDatetime: '2099-06-02T11:30:00' })
  });
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.ok(firstBody.sessionId);

  const second = await request('POST', `/api/payments/${payment.paymentId}/confirm-booking`, {
    body: bookingPayload(payment, { sessionDate: '2099-06-02', sessionTime: '11:30', sessionDatetime: '2099-06-02T11:30:00' })
  });
  const secondBody = await second.json();
  assert.equal(secondBody.alreadyConfirmed, true);
  assert.equal(secondBody.sessionId, firstBody.sessionId);
});

test('confirm-booking can derive booking data from payment metadata', async () => {
  const { body: payment } = await createMockPayment({
    sessionDate: '2099-06-08',
    sessionTime: '19:00',
    sessionDatetime: '2099-06-08T19:00:00'
  });
  const response = await request('POST', `/api/payments/${payment.paymentId}/confirm-booking`, {
    body: { token: payment.statusToken }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.sessionId);
});

test('confirm-booking rejects a token mismatch', async () => {
  const { body: payment } = await createMockPayment({
    sessionDate: '2099-06-03',
    sessionTime: '13:00',
    sessionDatetime: '2099-06-03T13:00:00'
  });
  const response = await request('POST', `/api/payments/${payment.paymentId}/confirm-booking`, {
    body: bookingPayload(payment, { token: 'bad-token', sessionDate: '2099-06-03', sessionTime: '13:00', sessionDatetime: '2099-06-03T13:00:00' })
  });
  assert.equal(response.status, 403);
});

test('an occupied individual slot cannot be double-booked', async () => {
  const first = await createMockPayment({
    sessionDate: '2099-06-04',
    sessionTime: '14:30',
    sessionDatetime: '2099-06-04T14:30:00'
  });
  await request('POST', `/api/payments/${first.body.paymentId}/confirm-booking`, {
    body: bookingPayload(first.body, { sessionDate: '2099-06-04', sessionTime: '14:30', sessionDatetime: '2099-06-04T14:30:00' })
  });

  const second = await createMockPayment({
    sessionDate: '2099-06-04',
    sessionTime: '14:30',
    sessionDatetime: '2099-06-04T14:30:00',
    customerEmail: 'other@example.com',
    customerPhone: '+79991112233'
  });

  assert.equal(second.response.status, 409);
  assert.equal(second.body.code, 'slot_taken');
});

test('create-payment rejects a booking on a blocked date', async () => {
  const blockDate = '2099-06-05';
  await db.run('INSERT OR REPLACE INTO schedule_exceptions (date, reason) VALUES (?, ?)', [blockDate, 'test']);

  try {
    const { response, body } = await createMockPayment({
      sessionDate: blockDate,
      sessionTime: '10:00',
      sessionDatetime: `${blockDate}T10:00:00`
    });
    assert.equal(response.status, 409);
    assert.equal(body.code, 'date_blocked');
  } finally {
    await db.run('DELETE FROM schedule_exceptions WHERE date = ?', [blockDate]);
  }
});

test('schedule endpoint returns free slots', async () => {
  const response = await request('GET', '/api/schedule?serviceId=consult&days=7');
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(typeof body.freeSlots, 'object');
  assert.equal(typeof body.allSlots, 'object');
});

test('admin cleanup removes a payment and its sessions', async () => {
  const { body: payment } = await createMockPayment({
    sessionDate: '2099-06-06',
    sessionTime: '16:00',
    sessionDatetime: '2099-06-06T16:00:00'
  });
  await request('POST', `/api/payments/${payment.paymentId}/confirm-booking`, {
    body: bookingPayload(payment, { sessionDate: '2099-06-06', sessionTime: '16:00', sessionDatetime: '2099-06-06T16:00:00' })
  });

  const response = await request('POST', '/api/admin/database/cleanup', {
    headers: ADMIN_HEADERS,
    body: { scope: 'payment', paymentId: payment.paymentId }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.deletedPayment, 1);
  assert.equal(body.deletedSessions, 1);
  assert.equal(await db.getPayment(payment.paymentId), undefined);
});

test('admin cleanup (all) requires explicit confirmation', async () => {
  const response = await request('POST', '/api/admin/database/cleanup', {
    headers: ADMIN_HEADERS,
    body: { scope: 'all' }
  });
  assert.equal(response.status, 400);
});

test('delete payment endpoint removes the payment', async () => {
  const { body: payment } = await createMockPayment({ sessionDate: '2099-06-07', sessionTime: '17:30', sessionDatetime: '2099-06-07T17:30:00' });
  const response = await request('DELETE', `/api/payments/${payment.paymentId}`, { headers: ADMIN_HEADERS });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.deletedPayment, 1);
});

test('VK notification message includes booking details', async () => {
  const message = buildVkEventMessage({
    type: 'booking_created',
    clientName: 'Test User',
    serviceName: 'Consultation',
    sessionDate: '2099-01-01',
    sessionTime: '10:00',
    status: 'scheduled',
    paymentId: 'pay_test',
    amount: 3500
  });

  assert.match(message, /Имя клиента: Test User/);
  assert.match(message, /Услуга: Consultation/);
  assert.match(message, /Дата: 2099-01-01/);
  assert.match(message, /Время: 10:00/);
  assert.match(message, /Статус записи: запланирована/);
});

// —————————————————————————————— ЗАПУСК ——————————————————————————————

(async () => {
  await db.ready;
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`ok - ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${item.name}`);
      console.error(error);
    }
  }

  await new Promise(resolve => server.close(resolve));
  await db.close();

  // Удаляем временную базу.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TEST_DB + suffix);
    } catch {
      /* файла может не быть */
    }
  }

  console.log(`\n${tests.length - failed}/${tests.length} тестов пройдено`);
  if (failed > 0) process.exitCode = 1;
})();
