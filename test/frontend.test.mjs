import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const read = name => fs.readFile(new URL(`../${name}`, import.meta.url), 'utf8');
test('a URL parameter cannot display a booking confirmation', async () => {
  let ready;
  const opened = [];
  const document = {
    addEventListener: (event, handler) => { if (event === 'DOMContentLoaded') ready = handler; },
    getElementById: id => ({ classList: { remove: name => opened.push([id, name]) }, addEventListener() {} })
  };
  vm.runInNewContext(await read('frontend/js/main.js'), {
    document, window: { location: { search: '?payment_success=true' }, history: { replaceState() {} } },
    URLSearchParams, setTimeout: callback => callback()
  });
  ready();
  assert.deepEqual(opened, []);
});
test('preview contains public content and no transactional UI or code', async () => {
  const html = await read('dist/index.html');
  assert.match(html, /Предварительная версия/);
  assert.match(html, /noindex, nofollow/);
  assert.match(html, /Консультации и стоимость/);
  assert.doesNotMatch(html, /<form\b|id="phone"|id="pay-btn"|js\/booking\.js|js\/reviews\.js/);
  const diplomas = JSON.parse(await read('dist/preview/diplomas.json'));
  assert.ok(diplomas.diplomas.length > 0);
  for (const diploma of diplomas.diplomas) await fs.access(new URL(`../dist/${diploma.img}`, import.meta.url));
  for (const name of ['backend', '.env', 'payment-check.html', 'js/booking.js']) {
    await assert.rejects(fs.access(new URL(`../dist/${name}`, import.meta.url)), { code: 'ENOENT' });
  }
});
