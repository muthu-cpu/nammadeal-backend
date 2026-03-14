/**
 * ONDC Beckn Message Builder
 * Builds valid Beckn v1.2 context + message payloads.
 */
const { v4: uuidv4 } = require('uuid');

const DOMAIN_MAP = {
  grocery:  'nic2004:52110',
  food:     'nic2004:56101',
  pharma:   'nic2004:52320',
  rides:    'ONDC:TRV10',
  travels:  'ONDC:TRV11',
};

function buildContext({ action, domain = 'grocery', transactionId, messageId }) {
  return {
    domain:          DOMAIN_MAP[domain] || DOMAIN_MAP.grocery,
    action,
    country:         'IND',
    city:            'std:080',           // Bengaluru STD code
    core_version:    '1.2.0',
    bap_id:          process.env.ONDC_SUBSCRIBER_ID || 'nammadeal.app',
    bap_uri:         process.env.BACKEND_URL         || 'https://api.nammadeal.app',
    transaction_id:  transactionId || uuidv4(),
    message_id:      messageId     || uuidv4(),
    timestamp:       new Date().toISOString(),
    ttl:             'PT30S',
  };
}

/** Search for items by keyword */
function buildSearchPayload({ query, domain, location }) {
  const txId = uuidv4();
  return {
    context: buildContext({ action: 'search', domain, transactionId: txId }),
    message: {
      intent: {
        item: { descriptor: { name: query } },
        fulfillment: {
          type: 'Delivery',
          ...(location ? {
            end: {
              location: {
                gps: `${location.lat},${location.lng}`,
                address: { area_code: location.areaCode || '560001' },
              },
            },
          } : {}),
        },
      },
    },
  };
}

/** Select an item to get exact price */
function buildSelectPayload({ context, provider, items }) {
  return {
    context: { ...context, action: 'select', message_id: uuidv4() },
    message: {
      order: {
        provider: { id: provider.id, locations: [{ id: provider.locationId }] },
        items: items.map(i => ({ id: i.id, quantity: { count: i.qty || 1 } })),
        fulfillment: { type: 'Delivery' },
      },
    },
  };
}

module.exports = { buildContext, buildSearchPayload, buildSelectPayload, DOMAIN_MAP };
