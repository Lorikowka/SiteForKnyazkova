function run(rawDb, sql, params = []) {
  return new Promise((resolve, reject) => {
    rawDb.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(rawDb, sql, params = []) {
  return new Promise((resolve, reject) => {
    rawDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function normalizeIdentity(value = '') {
  return String(value || '').trim().toLowerCase();
}

async function createSessionWithSlotGuard(db, data, options = {}) {
  if (db.ready) await db.ready;

  const rawDb = db.db;
  const serviceType = options.serviceType || (data.service_id === 'group' ? 'group' : 'individual');
  const capacity = Math.max(1, Number(options.capacity) || 1);
  const activeStatuses = ['scheduled', 'completed'];
  const activePlaceholders = activeStatuses.map(() => '?').join(', ');

  await run(rawDb, 'BEGIN IMMEDIATE');
  try {
    if (serviceType === 'group') {
      const countRow = await get(
        rawDb,
        `SELECT COUNT(*) AS total
         FROM sessions
         WHERE session_datetime = ?
           AND service_id = ?
           AND status IN (${activePlaceholders})`,
        [data.session_datetime, data.service_id || 'group', ...activeStatuses]
      );

      if ((countRow?.total || 0) >= capacity) {
        const err = new Error('Group slot is full');
        err.code = 'SLOT_FULL';
        throw err;
      }

      const duplicateRow = await get(
        rawDb,
        `SELECT id
         FROM sessions
         WHERE session_datetime = ?
           AND service_id = ?
           AND status IN (${activePlaceholders})
           AND (
             (client_email <> '' AND lower(client_email) = ?)
             OR (client_phone <> '' AND client_phone = ?)
           )
         LIMIT 1`,
        [
          data.session_datetime,
          data.service_id || 'group',
          ...activeStatuses,
          normalizeIdentity(data.client_email),
          normalizeIdentity(data.client_phone)
        ]
      );

      if (duplicateRow) {
        const err = new Error('Duplicate group booking');
        err.code = 'DUPLICATE_GROUP_BOOKING';
        throw err;
      }
    } else {
      const busyRow = await get(
        rawDb,
        `SELECT id
         FROM sessions
         WHERE session_datetime = ?
           AND status IN (${activePlaceholders})
         LIMIT 1`,
        [data.session_datetime, ...activeStatuses]
      );

      if (busyRow) {
        const err = new Error('Slot is already taken');
        err.code = 'SLOT_TAKEN';
        throw err;
      }
    }

    const result = await run(
      rawDb,
      `INSERT INTO sessions (
        payment_id, client_name, client_phone, client_email,
        service_id, service_name, session_date, session_time, session_datetime,
        amount, comment, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.payment_id,
        data.client_name,
        data.client_phone,
        data.client_email,
        data.service_id || null,
        data.service_name,
        data.session_date,
        data.session_time,
        data.session_datetime,
        data.amount,
        data.comment,
        data.status || 'scheduled'
      ]
    );

    if (options.paymentUpdate) {
      const update = options.paymentUpdate;
      await run(
        rawDb,
        `UPDATE payments
         SET customer_email = ?,
             customer_phone = ?,
             customer_name = ?,
             service_id = ?,
             service_name = ?,
             comment = ?,
             metadata = ?
         WHERE id = ?`,
        [
          update.customer_email || null,
          update.customer_phone || null,
          update.customer_name || null,
          update.service_id || null,
          update.service_name || null,
          update.comment || null,
          update.metadata ? JSON.stringify(update.metadata) : null,
          data.payment_id
        ]
      );
    }

    await run(rawDb, 'COMMIT');
    return { id: result.lastID, payment_id: data.payment_id };
  } catch (err) {
    await run(rawDb, 'ROLLBACK').catch(() => {});
    throw err;
  }
}

module.exports = {
  createSessionWithSlotGuard
};
