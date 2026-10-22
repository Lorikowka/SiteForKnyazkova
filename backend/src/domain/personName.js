const cleanPart = (value) => String(value || '').trim().replace(/\s+/g, ' ');

/** Prefer structured parts; preserve a legacy full name for old records and API clients. */
export function buildPersonName({ lastName, firstName, middleName, fullName } = {}) {
  const parts = [lastName, firstName, middleName].map(cleanPart).filter(Boolean);
  return parts.length >= 2 ? parts.join(' ') : cleanPart(fullName);
}

export function personNameParts(source = {}, prefix = 'customer') {
  return {
    lastName: cleanPart(source[`${prefix}LastName`] ?? source[`${prefix}_last_name`]),
    firstName: cleanPart(source[`${prefix}FirstName`] ?? source[`${prefix}_first_name`]),
    middleName: cleanPart(source[`${prefix}MiddleName`] ?? source[`${prefix}_middle_name`]),
    fullName: cleanPart(source[`${prefix}Name`] ?? source[`${prefix}_name`] ?? source.customerName)
  };
}
