/**
 * ONDC Beckn Message Builder — v1.2
 * Builds valid Beckn context + message payloads for all Buyer NP actions.
 */
const { v4: uuidv4 } = require('uuid');

/* ── Domain codes per ONDC Network Policy ─────────────────── */
const DOMAIN_MAP = {
  grocery:  'ONDC:RET10',
  food:     'ONDC:RET11',
  pharma:   'ONDC:RET18',
  rides:    'ONDC:TRV10',
  travels:  'ONDC:TRV11',
};

/* ── Shared context builder ───────────────────────────────── */
function buildContext({ action, domain = 'grocery', transactionId, messageId, bppId, bppUri }) {
  const ctx = {
    domain:         DOMAIN_MAP[domain] || DOMAIN_MAP.grocery,
    action,
    country:        'IND',
    city:           '*',           // pan-India (Pramaan mock is pan-India)
    core_version:   '1.2.0',
    // Use ONDC_BAP_ID if set; fall back to the Railway subscriber URL (NOT the nammadeal.app alias)
    bap_id:         process.env.ONDC_BAP_ID  || 'acceptable-dedication-production-5bcd.up.railway.app',
    bap_uri:        process.env.ONDC_BAP_URI || 'https://acceptable-dedication-production-5bcd.up.railway.app',
    transaction_id: transactionId  || uuidv4(),
    message_id:     messageId      || uuidv4(),
    timestamp:      new Date().toISOString(),
    ttl:            'PT30S',
  };
  if (bppId)  ctx.bpp_id  = bppId;
  if (bppUri) ctx.bpp_uri = bppUri;
  return ctx;
}

/* ── Delivery location helper ─────────────────────────────── */
const DEFAULT_DELIVERY = {
  gps: '28.4089,77.0408',           // Gurgaon coords for PIN 122007
  address: {
    door:       'Test Address',
    building:   'Test Building',
    street:     'Sector 56',
    city:       'Gurgaon',
    state:      'Haryana',
    country:    'IND',
    area_code:  '122007',
  },
};

const DEFAULT_BILLING = {
  name:    'NammaDeal Test User',
  phone:   '9999999999',
  email:   'test@nammadeal.app',
  address: DEFAULT_DELIVERY.address,
};

/* ── SEARCH ───────────────────────────────────────────────── */
function buildSearchPayload({ query, domain, location }) {
  const txId = uuidv4();
  return {
    context: buildContext({ action: 'search', domain, transactionId: txId }),
    message: {
      intent: {
        item: { descriptor: { name: query } },
        fulfillment: {
          type: 'Delivery',
          end: {
            location: {
              gps:     location ? `${location.lat},${location.lng}` : DEFAULT_DELIVERY.gps,
              address: { area_code: location?.areaCode || '122007' },
            },
          },
        },
      },
    },
  };
}

/* ── SELECT ───────────────────────────────────────────────── */
function buildSelectPayload({ context, provider, item, fulfillmentId }) {
  return {
    context: {
      ...context,
      action:     'select',
      message_id: uuidv4(),
    },
    message: {
      order: {
        provider: {
          id:        provider.id,
          locations: provider.locationId ? [{ id: provider.locationId }] : [],
        },
        items: [{
          id:       item.id,
          quantity: { count: 1 },
        }],
        fulfillments: [{
          id:   fulfillmentId || '1',
          type: 'Delivery',
          end:  {
            location: {
              gps:     DEFAULT_DELIVERY.gps,
              address: { area_code: DEFAULT_DELIVERY.address.area_code },
            },
          },
        }],
      },
    },
  };
}

/* ── INIT ─────────────────────────────────────────────────── */
function buildInitPayload({ context, provider, item, quote }) {
  return {
    context: {
      ...context,
      action:     'init',
      message_id: uuidv4(),
    },
    message: {
      order: {
        provider: {
          id:        provider.id,
          locations: provider.locationId ? [{ id: provider.locationId }] : [],
        },
        items: [{
          id:       item.id,
          quantity: { count: 1 },
        }],
        billing: DEFAULT_BILLING,
        fulfillments: [{
          id:   '1',
          type: 'Delivery',
          end:  {
            location: DEFAULT_DELIVERY,
            contact:  {
              phone: DEFAULT_BILLING.phone,
              email: DEFAULT_BILLING.email,
            },
          },
        }],
        payment: {
          type:           'ON-ORDER',
          paid_amount:    quote?.price?.value || '0',
          status:         'NOT-PAID',
          currency:       'INR',
          transaction_id: uuidv4(),
        },
      },
    },
  };
}

/* ── CONFIRM ──────────────────────────────────────────────── */
function buildConfirmPayload({ context, provider, item, quote, paymentTxnId }) {
  return {
    context: {
      ...context,
      action:     'confirm',
      message_id: uuidv4(),
    },
    message: {
      order: {
        provider: {
          id:        provider.id,
          locations: provider.locationId ? [{ id: provider.locationId }] : [],
        },
        items: [{
          id:       item.id,
          quantity: { count: 1 },
        }],
        billing: DEFAULT_BILLING,
        fulfillments: [{
          id:   '1',
          type: 'Delivery',
          end:  {
            location: DEFAULT_DELIVERY,
            contact:  {
              phone: DEFAULT_BILLING.phone,
              email: DEFAULT_BILLING.email,
            },
          },
        }],
        payment: {
          type:           'ON-ORDER',
          paid_amount:    quote?.price?.value || '0',
          status:         'PAID',
          currency:       'INR',
          transaction_id: paymentTxnId || uuidv4(),
        },
      },
    },
  };
}

/* ── STATUS ───────────────────────────────────────────────── */
function buildStatusPayload({ context, orderId }) {
  return {
    context: {
      ...context,
      action:     'status',
      message_id: uuidv4(),
    },
    message: { order_id: orderId },
  };
}

/* ── TRACK ────────────────────────────────────────────────── */
function buildTrackPayload({ context, orderId }) {
  return {
    context: {
      ...context,
      action:     'track',
      message_id: uuidv4(),
    },
    message: { order_id: orderId },
  };
}

module.exports = {
  buildContext,
  buildSearchPayload,
  buildSelectPayload,
  buildInitPayload,
  buildConfirmPayload,
  buildStatusPayload,
  buildTrackPayload,
  DOMAIN_MAP,
};
