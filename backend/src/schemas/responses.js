const nullableString = { type: ['string', 'null'] };

export const healthResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'timestamp', 'service', 'database'],
  properties: {
    status: { enum: ['ok', 'degraded'] },
    timestamp: { type: 'string' },
    service: { const: 'psixolog-payment-backend' },
    database: { enum: ['ok', 'error'] }
  }
};

export const createPaymentResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'paymentId', 'confirmationUrl', 'amount', 'statusToken'],
  properties: {
    success: { const: true },
    paymentId: { type: 'string' },
    providerPaymentId: { type: 'string' },
    confirmationUrl: { type: 'string' },
    amount: { type: 'string' },
    statusToken: { type: 'string' },
    mock: { type: 'boolean' }
  }
};

export const paymentStatusResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'payment'],
  properties: {
    success: { const: true },
    payment: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'status', 'amount', 'currency'],
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        amount: { type: 'number' },
        currency: { type: 'string' },
        description: nullableString,
        created_at: nullableString,
        paid_at: nullableString,
        service_name: nullableString
      }
    }
  }
};

const safePaymentMetadata = {
  type: 'object',
  additionalProperties: false,
  properties: {
    serviceId: { type: 'string' },
    customerEmail: { type: 'string' },
    customerName: { type: 'string' },
    customerLastName: { type: 'string' },
    customerFirstName: { type: 'string' },
    customerMiddleName: { type: 'string' },
    customerPhone: { type: 'string' },
    serviceName: { type: 'string' },
    sessionDate: { type: 'string' },
    sessionTime: { type: 'string' },
    sessionDatetime: { type: 'string' },
    comment: { type: 'string' }
  }
};

export const paymentListResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'payments', 'pagination'],
  properties: {
    success: { const: true },
    payments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'amount', 'currency', 'status', 'metadata'],
        properties: {
          id: { type: 'string' },
          provider_payment_id: nullableString,
          amount: { type: 'number' },
          currency: { type: 'string' },
          status: { type: 'string' },
          description: nullableString,
          customer_email: nullableString,
          customer_phone: nullableString,
          customer_name: nullableString,
          customer_last_name: nullableString,
          customer_first_name: nullableString,
          customer_middle_name: nullableString,
          service_id: nullableString,
          service_name: nullableString,
          comment: nullableString,
          payment_method: nullableString,
          created_at: nullableString,
          paid_at: nullableString,
          metadata: safePaymentMetadata
        }
      }
    },
    pagination: {
      type: 'object',
      additionalProperties: false,
      required: ['page', 'limit', 'total', 'totalPages'],
      properties: {
        page: { type: 'integer' },
        limit: { type: 'integer' },
        total: { type: 'integer' },
        totalPages: { type: 'integer' }
      }
    }
  }
};

export const reviewCreatedResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['success', 'id'],
  properties: { success: { const: true }, id: { type: 'integer' } }
};
