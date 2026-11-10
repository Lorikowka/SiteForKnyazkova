import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Only the public frontend is copied. No server source, secrets or database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
for (const name of ['index.html', 'offer.html', 'privacy.html', 'consent.html', 'css', 'images', 'js']) {
  await fs.cp(path.join(root, 'frontend', name), path.join(out, name), { recursive: true });
}
const config = JSON.parse(await fs.readFile(path.join(root, 'backend/config.json'), 'utf8'));
const diplomas = JSON.parse(await fs.readFile(path.join(root, 'backend/diplomas.json'), 'utf8'));
await fs.mkdir(path.join(out, 'preview'), { recursive: true });
await fs.writeFile(path.join(out, 'preview/diplomas.json'), JSON.stringify({ success: true, diplomas }));
let html = await fs.readFile(path.join(out, 'index.html'), 'utf8');
const replaceSection = (id, content) => {
  const pattern = new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`);
  if (!pattern.test(html)) throw new Error(`Missing section: ${id}`);
  html = html.replace(pattern, content);
};
replaceSection('reviews', `<section id="reviews" class="section section-soft"><div class="container narrow"><h2>Отзывы</h2><p>В предварительной версии отправка отзывов отключена. Она станет доступна после подключения сервера.</p></div></section>`);
replaceSection('payment', `<section id="payment" class="section"><div class="container"><h2>Консультации и стоимость</h2><p>Данные из текущего каталога. Онлайн-запись и оплата пока не подключены.</p><div class="cards">${config.services.map(s => `<article class="card"><h3>${escape(s.name)}</h3><p>${escape(s.description)}</p><p><strong>${escape(new Intl.NumberFormat('ru-RU').format(s.price))} ₽</strong></p></article>`).join('')}</div><p>Эта версия предназначена для просмотра и не принимает записи.</p></div></section>`);
html = html.replace('<body>', '<body>\n<aside class="preview-notice" aria-label="Статус сайта"><strong>Предварительная версия</strong><span>Запись, оплата и отправка отзывов ещё не подключены.</span></aside>');
html = html.replace('>Записаться на консультацию</a>', '>Форматы и стоимость</a>').replace('href="#payment">Запись</a>', 'href="#payment">Консультации</a>');
html = html.replace('<meta name="description"', '<meta name="robots" content="noindex, nofollow">\n  <meta name="description"');
html = html.replace(/  <script src="js\/(booking|reviews)\.js[^\n]+\n/g, '');
html = html.replace(/https:\/\/psy-knyazkova\.ru/g, 'https://knyazkova-preview.lankyfancy1.chatgpt.site');
await fs.writeFile(path.join(out, 'index.html'), html);
// Local JSON catalog keeps the existing gallery working without a backend.
const galleryPath = path.join(out, 'js/gallery.js');
const gallery = await fs.readFile(galleryPath, 'utf8');
await fs.writeFile(galleryPath, gallery.replace("apiRequest('/api/diplomas')", "fetch('preview/diplomas.json').then(response => { if (!response.ok) throw new Error('Не удалось загрузить дипломы'); return response.json(); })"));
await fs.appendFile(path.join(out, 'css/styles.css'), '\n.preview-notice{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 18px;padding:12px 4%;background:#edf3e9;color:#234c38;border-bottom:1px solid #c5e0d0;font-size:14px;text-align:center}\n');
// Remove unused transactional code from the published preview entirely.
for (const name of ['booking.js', 'reviews.js', 'payment-check.js', 'payment-failed.js']) await fs.rm(path.join(out, 'js', name));
await fs.writeFile(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('Static preview built in dist/ (booking and payments disabled).');
