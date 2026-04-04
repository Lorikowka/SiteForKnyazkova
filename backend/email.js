/**
 * ═══════════════════════════════════════════════════════════
 * 📧 Модуль отправки email уведомлений
 * ═══════════════════════════════════════════════════════════
 */

const nodemailer = require('nodemailer');

// Создаём транспортер для Mail.ru
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.mail.ru',
  port: parseInt(process.env.EMAIL_PORT) || 465,
  secure: process.env.EMAIL_SECURE !== 'false', // true для 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

/**
 * Отправляет письмо с подтверждением записи клиенту
 * @param {Object} options - Параметры письма
 * @param {string} options.to - Email получателя
 * @param {string} options.clientName - Имя клиента
 * @param {string} options.serviceName - Название услуги
 * @param {string} options.sessionDate - Дата сеанса
 * @param {string} options.sessionTime - Время сеанса
 * @param {number} options.amount - Сумма оплаты
 * @param {string} [options.comment] - Комментарий клиента
 */
async function sendBookingConfirmation(options) {
  const { to, clientName, serviceName, sessionDate, sessionTime, amount, comment } = options;

  if (!to) {
    return { success: false, error: 'Email получателя не указан' };
  }

  const mailOptions = {
    from: `"Екатерина Князькова - Психолог" <${process.env.EMAIL_FROM}>`,
    to,
    subject: '✅ Подтверждение записи на консультацию',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px; color: white; text-align: center; margin-bottom: 20px;">
          <h1 style="margin: 0; font-size: 28px;">Запись подтверждена</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Уважаемая(ый) ${clientName}!</p>
        </div>

        <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin-bottom: 20px;">
          <h2 style="color: #333; margin-top: 0;">📋 Детали записи</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 0; color: #666; font-weight: bold;">Услуга:</td>
              <td style="padding: 10px 0; color: #333;">${serviceName}</td>
            </tr>
            <tr style="background: #fff;">
              <td style="padding: 10px 0; color: #666; font-weight: bold;">Дата:</td>
              <td style="padding: 10px 0; color: #333;">${sessionDate}</td>
            </tr>
            <tr>
              <td style="padding: 10px 0; color: #666; font-weight: bold;">Время:</td>
              <td style="padding: 10px 0; color: #333;">${sessionTime}</td>
            </tr>
            <tr style="background: #fff;">
              <td style="padding: 10px 0; color: #666; font-weight: bold;">Сумма оплаты:</td>
              <td style="padding: 10px 0; color: #333; font-weight: bold;">${amount} ₽</td>
            </tr>
          </table>
        </div>

        ${comment ? `
        <div style="background: #fff3cd; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #ffc107;">
          <p style="margin: 0; color: #856404;">
            <strong>📝 Ваш комментарий:</strong><br>
            ${comment}
          </p>
        </div>
        ` : ''}

        <div style="background: #d4edda; padding: 20px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #28a745;">
          <p style="margin: 0; color: #155724;">
            <strong>✅ Оплата получена</strong><br>
            Ваш сеанс успешно забронирован и оплачен.
          </p>
        </div>

        <div style="text-align: center; padding: 20px; color: #666; font-size: 14px; border-top: 1px solid #ddd;">
          <p style="margin: 5px 0;">Если у вас есть вопросы, свяжитесь с нами.</p>
          <p style="margin: 5px 0; font-weight: bold;">С уважением, психолог Екатерина Князькова</p>
        </div>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendBookingConfirmation
};
