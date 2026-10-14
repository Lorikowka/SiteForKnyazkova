/**
 * Отправка письма-подтверждения клиенту по SMTP.
 *
 * Транспорт создаётся один раз (пул соединений), а не на каждое письмо.
 */
import nodemailer from 'nodemailer';

import config from '../config/index.js';
import { escapeHtml } from '../lib/text.js';
import logger from '../utils/logger.js';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const { host, port, user, pass } = config.smtp;
  if (!user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    pool: true,
    maxConnections: 3
  });
  return transporter;
}

export async function sendEmailConfirmation({ email, name, amount, serviceName, sessionDate, sessionTime, paymentId }) {
  const { from } = config.smtp;
  const mailer = getTransporter();

  if (!mailer) {
    logger.warn('SMTP не настроен. Email не отправлен.');
    return;
  }

  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #2c7a55;">✅ Оплата прошла успешно!</h2>
        <p>Здравствуйте, <strong>${escapeHtml(name)}</strong>!</p>
        <p>Ваша оплата принята. Детали записи:</p>

        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Услуга:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong>${escapeHtml(serviceName)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Дата:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(sessionDate || '—')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Время:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(sessionTime || '—')}</td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">Сумма:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong style="color: #2c7a55;">${escapeHtml(String(amount ?? '—'))} ₽</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">ID платежа:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(paymentId)}</td>
          </tr>
        </table>

        <p style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; color: #999; font-size: 14px;">
          Мы свяжемся с вами для подтверждения записи.<br>
          Если у вас есть вопросы, напишите нам в
          <a href="https://t.me/Ekaterina_K" style="color: #2c7a55;">Telegram</a>
        </p>
      </div>
    `;

    await mailer.sendMail({
      from: `"Екатерина Князькова" <${from}>`,
      to: email,
      subject: '✅ Оплата принята — Консультация психолога',
      html: htmlContent
    });

    logger.info(`📧 Email отправлен на ${email}`);
  } catch (error) {
    logger.error(`❌ Ошибка отправки email: ${error.message}`);
  }
}
