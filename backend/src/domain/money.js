/** Store money as integer minor units; decimal rubles remain an API compatibility view. */
export function toMinorUnits(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new TypeError('Amount must be a non-negative number');
  return Math.round((amount + Number.EPSILON) * 100);
}

export function fromMinorUnits(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new TypeError('Minor amount must be a non-negative integer');
  return amount / 100;
}
