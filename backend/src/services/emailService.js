const nodemailer = require('nodemailer');
const config = require('../utils/config');
const logger = require('../utils/logger');
const { escapeHtml } = require('../../database');

async function sendEmailConfirmation({ email, name, amount, serviceName, sessionDate, sessionTime, paymentId }) {
  const { host, port, user, pass, from } = config.smtp;
  
  if (!user || !pass) {
    logger.warn('SMTP не настроен. Email не отправлен.');
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #667eea;">✅ Оплата прошла успешно!</h2>
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
            <td style="padding: 10px; border-bottom: 1px solid #eee;"><strong style="color: #4CAF50;">${escapeHtml(amount.toString())} ₽</strong></td>
          </tr>
          <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee; color: #666;">ID платежа:</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(paymentId)}</td>
          </tr>
        </table>

        <p style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #eee; color: #999; font-size: 14px;">
          Мы свяжемся с вами для подтверждения записи.<br>
          Если у вас есть вопросы, напишите нам в
          <a href="https://t.me/Ekaterina_K" style="color: #667eea;">Telegram</a>
        </p>
      </div>
    `;

    await transporter.sendMail({
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

module.exports = { sendEmailConfirmation };
