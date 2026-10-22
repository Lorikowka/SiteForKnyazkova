import db from '../db/index.js';

/** Protected operational signals, without customer details or access tokens. */
export async function getOperations(request, reply) {
  const pending = db.get("SELECT COUNT(*) AS count FROM payments WHERE status IN ('pending', 'waiting_for_capture')").count;
  const stalePending = db.get("SELECT COUNT(*) AS count FROM payments WHERE status IN ('pending', 'waiting_for_capture') AND datetime(created_at) < datetime('now', '-30 minutes')").count;
  const unconfirmedPaid = db.get(`SELECT COUNT(*) AS count FROM payments p WHERE p.status = 'succeeded'
    AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.payment_id = p.id)`).count;
  return reply.send({ success: true, pending, stalePending, unconfirmedPaid,
    needsAttention: stalePending > 0 || unconfirmedPaid > 0, checkedAt: new Date().toISOString() });
}
