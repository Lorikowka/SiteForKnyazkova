const assert = require('node:assert/strict');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.API_KEY = 'test-admin-key';
process.env.ADMIN_API_KEYS = 'test-admin-key';
process.env.BOT_API_KEYS = 'test-bot-key';
process.env.MOCK_MODE = 'true';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_CHAT_ID = '';
process.env.VK_BOT_TOKEN = '';
process.env.VK_NOTIFY_PEER_IDS = '';

const app = require('../server');
const db = require('../database');
const { buildVkEventMessage } = require('../lib/vkNotifier');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

async function withServer(fn) {
  await db.ready;
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('health endpoint returns service status', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.service, 'psixolog-payment-backend');
  });
});

test('reviews endpoint stores a site review', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rating: 5,
        name: 'Test User',
        contact: '+7 999 000-00-00',
        message: 'The consultation was helpful and comfortable.'
      })
    });
    const body = await response.json();
    const rows = await db.getAllReviews(1);

    assert.equal(response.status, 201);
    assert.equal(body.success, true);
    assert.equal(rows[0].id, body.id);
    assert.equal(rows[0].rating, 5);
    assert.equal(rows[0].name, 'Test User');
  });
});

test('admin sessions endpoint requires an API key', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/sessions`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.success, false);
  });
});

test('bot API key can access filtered sessions endpoint', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/sessions?from=2099-01-01T00:00:00&to=2099-01-02T00:00:00`, {
      headers: { 'X-Bot-API-Key': 'test-bot-key' }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.ok(Array.isArray(body.sessions));
    assert.equal(body.pagination.page, 1);
  });
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

(async () => {
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

  await new Promise(resolve => db.db.close(resolve));

  if (failed > 0) {
    process.exitCode = 1;
  }
})();
