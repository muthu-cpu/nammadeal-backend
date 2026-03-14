/**
 * NammaDeal Backend — ONDC Buyer NP Server
 * ═══════════════════════════════════════════════════════════
 * Buyer NP outbound calls  → ONDC Gateway / Pramaan BPP:
 *   POST /api/search        ← App calls this to start a search
 *   POST /api/select/:txId  ← Selects an item from on_search catalog
 *   POST /api/init/:txId    ← Sends init to BPP
 *   POST /api/confirm/:txId ← Sends confirm to BPP
 *   POST /api/status/:txId  ← Sends status request to BPP
 *   POST /api/track/:txId   ← Sends track request to BPP
 *
 * Result polling:
 *   GET  /api/results/:txId        ← search results (on_search)
 *   GET  /api/order-state/:txId    ← full order state
 *
 * ONDC Webhook Callbacks (called by ONDC Gateway / Pramaan):
 *   POST /ondc/on_search    ← Seller prices arrive here (auto-triggers select)
 *   POST /ondc/on_select    ← Quote response (auto-triggers init)
 *   POST /ondc/on_init      ← Init response (auto-triggers confirm)
 *   POST /ondc/on_confirm   ← Order confirmed (auto-triggers status + track)
 *   POST /ondc/on_status    ← Order status
 *   POST /ondc/on_track     ← Tracking info
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const path    = require('path');

const { createAuthHeader }    = require('./ondcCrypto');
const {
  buildSearchPayload,
  buildSelectPayload,
  buildInitPayload,
  buildConfirmPayload,
  buildStatusPayload,
  buildTrackPayload,
} = require('./ondcMessages');

const cache = require('./resultCache');   // search results cache

const app  = express();
const PORT = process.env.PORT || 3000;

const GATEWAY_URL = process.env.ONDC_GATEWAY_URL || 'https://staging.registry.ondc.org/ondc';
const PRAMAAN_BPP = 'https://pramaan.ondc.org/beta/preprod/mock/seller';

/* ── Order state: tracks the full lifecycle per transaction ── */
// txId → { context, provider, item, quote, orderId, bppUri, ... }
const orderState = new Map();

app.use(cors());
app.use(express.json());

/* Static disclosure PDFs */
app.use('/public', express.static(path.join(__dirname, '../public')));

/* Request logger */
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

/* ── Helper: send signed ONDC call to a BPP / gateway ──────── */
async function sendONDC(url, payload) {
  const bodyStr    = JSON.stringify(payload);
  const authHeader = createAuthHeader(bodyStr);
  const resp = await axios.post(url, payload, {
    headers: {
      'Content-Type':  'application/json',
      'Authorization': authHeader,
    },
    timeout: 15000,
  });
  return resp.data;
}

/* ════════════════════════════════════════════════════════════
   HEALTH CHECK
   ════════════════════════════════════════════════════════════ */
app.get('/', (_req, res) => {
  res.json({
    status:           'ok',
    service:          'NammaDeal Backend',
    version:          '1.0.0',
    ondc_subscriber:  process.env.ONDC_SUBSCRIBER_ID || 'not set',
    time:             new Date().toISOString(),
  });
});

/* ════════════════════════════════════════════════════════════
   POST /api/search
   ════════════════════════════════════════════════════════════ */
app.post('/api/search', async (req, res) => {
  const { query, domain = 'grocery', location } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });

  try {
    const payload = buildSearchPayload({ query, domain, location });
    const txId    = payload.context.transaction_id;

    // Send search directly to Pramaan mock BPP (so Pramaan tracks it in test automation)
    // Also send to gateway for real network discovery
    sendONDC(`${PRAMAAN_BPP}/search`, payload).catch(err => {
      console.error('[Pramaan Search Error]', err.response?.data || err.message);
    });
    sendONDC(`${GATEWAY_URL}/search`, payload).catch(err => {
      console.error('[ONDC Gateway Search Error]', err.response?.data || err.message);
    });

    // Seed order state so callbacks can reference it
    orderState.set(txId, {
      domain,
      context: payload.context,
      step:    'search_sent',
    });

    console.log(`[Search] txId=${txId} query="${query}" domain=${domain}`);

    res.json({
      transactionId: txId,
      message:       `Search sent to ONDC. Poll /api/results/${txId} for prices.`,
    });
  } catch (err) {
    console.error('[/api/search error]', err.message);
    res.status(200).json({ transactionId: null, fallback: true, message: 'ONDC unavailable.' });
  }
});

/* ════════════════════════════════════════════════════════════
   POST /api/select/:txId
   Manually trigger select (in case auto-select didn't fire)
   ════════════════════════════════════════════════════════════ */
app.post('/api/select/:txId', async (req, res) => {
  const { txId } = req.params;
  const state = orderState.get(txId);
  const results = cache.get(txId);

  if (!results || results.length === 0) {
    return res.status(404).json({ error: 'No on_search results yet for this txId' });
  }

  const item = results[0];
  await doSelect(txId, item, state?.context);

  res.json({ message: 'select sent', transactionId: txId });
});

/* ════════════════════════════════════════════════════════════
   GET /api/results/:txId   (search results polling)
   ════════════════════════════════════════════════════════════ */
app.get('/api/results/:txId', (req, res) => {
  const results = cache.get(req.params.txId);
  if (!results) return res.json({ results: [], count: 0, done: false });
  res.json({ results, count: results.length, done: true });
});

/* ════════════════════════════════════════════════════════════
   GET /api/order-state/:txId   (full order state for debug)
   ════════════════════════════════════════════════════════════ */
app.get('/api/order-state/:txId', (req, res) => {
  const state = orderState.get(req.params.txId);
  if (!state) return res.status(404).json({ error: 'not found' });
  res.json(state);
});

/* ════════════════════════════════════════════════════════════
   POST /api/init/:txId  (manual trigger)
   ════════════════════════════════════════════════════════════ */
app.post('/api/init/:txId', async (req, res) => {
  const state = orderState.get(req.params.txId);
  if (!state?.provider) return res.status(404).json({ error: 'No select state found' });
  await doInit(req.params.txId, state);
  res.json({ message: 'init sent', transactionId: req.params.txId });
});

/* ════════════════════════════════════════════════════════════
   POST /api/confirm/:txId  (manual trigger)
   ════════════════════════════════════════════════════════════ */
app.post('/api/confirm/:txId', async (req, res) => {
  const state = orderState.get(req.params.txId);
  if (!state?.provider) return res.status(404).json({ error: 'No init state found' });
  await doConfirm(req.params.txId, state);
  res.json({ message: 'confirm sent', transactionId: req.params.txId });
});

/* ════════════════════════════════════════════════════════════
   POST /api/status/:txId  (manual trigger)
   ════════════════════════════════════════════════════════════ */
app.post('/api/status/:txId', async (req, res) => {
  const txId = req.params.txId;
  const state = orderState.get(txId);
  if (!state) return res.status(404).json({ error: 'Transaction not found' });
  // Use txId as fallback orderId if Pramaan mock didn't return one
  if (!state.orderId) state.orderId = txId;
  await doStatus(txId, state);
  res.json({ message: 'status sent', transactionId: txId, orderId: state.orderId });
});

/* ════════════════════════════════════════════════════════════
   POST /api/track/:txId  (manual trigger)
   ════════════════════════════════════════════════════════════ */
app.post('/api/track/:txId', async (req, res) => {
  const txId = req.params.txId;
  const state = orderState.get(txId);
  if (!state) return res.status(404).json({ error: 'Transaction not found' });
  // Use txId as fallback orderId if Pramaan mock didn't return one
  if (!state.orderId) state.orderId = txId;
  await doTrack(txId, state);
  res.json({ message: 'track sent', transactionId: txId, orderId: state.orderId });
});

/* ════════════════════════════════════════════════════════════
   ONDC FLOW HELPERS (shared by webhooks + manual endpoints)
   ════════════════════════════════════════════════════════════ */

async function doSelect(txId, catalogItem, baseContext) {
  const state = orderState.get(txId) || {};
  const ctx   = baseContext || state.context || {};
  const bppUri = catalogItem.bppUri || state.bppUri || PRAMAAN_BPP;

  const provider = {
    id:         catalogItem.providerId,
    locationId: catalogItem.locationId,
  };
  const item = { id: catalogItem.itemId };

  const selectCtx = {
    ...ctx,
    bpp_id:  catalogItem.bppId  || ctx.bpp_id,
    bpp_uri: bppUri,
  };

  const payload = buildSelectPayload({ context: selectCtx, provider, item });

  try {
    await sendONDC(`${bppUri}/select`, payload);
    console.log(`[doSelect] txId=${txId} provider=${provider.id} item=${item.id}`);

    orderState.set(txId, {
      ...state,
      context:  selectCtx,
      provider,
      item,
      bppUri,
      step: 'select_sent',
    });
  } catch (err) {
    console.error('[doSelect error]', err.response?.data || err.message);
  }
}

async function doInit(txId, state) {
  const payload = buildInitPayload({
    context:  state.context,
    provider: state.provider,
    item:     state.item,
    quote:    state.quote,
  });

  try {
    await sendONDC(`${state.bppUri}/init`, payload);
    console.log(`[doInit] txId=${txId}`);
    state.step = 'init_sent';
    orderState.set(txId, state);
  } catch (err) {
    console.error('[doInit error]', err.response?.data || err.message);
  }
}

async function doConfirm(txId, state) {
  const payload = buildConfirmPayload({
    context:      state.context,
    provider:     state.provider,
    item:         state.item,
    quote:        state.quote,
    paymentTxnId: state.paymentTxnId,
  });

  try {
    await sendONDC(`${state.bppUri}/confirm`, payload);
    console.log(`[doConfirm] txId=${txId}`);
    state.step = 'confirm_sent';
    orderState.set(txId, state);
  } catch (err) {
    console.error('[doConfirm error]', err.response?.data || err.message);
  }
}

async function doStatus(txId, state) {
  const orderId = state.orderId || txId; // fallback: use txId if Pramaan mock didn't return orderId
  const payload = buildStatusPayload({ context: state.context, orderId });
  try {
    await sendONDC(`${state.bppUri}/status`, payload);
    console.log(`[doStatus] txId=${txId} orderId=${orderId}`);
    state.step = 'status_sent';
    orderState.set(txId, state);
  } catch (err) {
    console.error('[doStatus error]', err.response?.data || err.message);
  }
}

async function doTrack(txId, state) {
  const orderId = state.orderId || txId; // fallback: use txId if Pramaan mock didn't return orderId
  const payload = buildTrackPayload({ context: state.context, orderId });
  try {
    await sendONDC(`${state.bppUri}/track`, payload);
    console.log(`[doTrack] txId=${txId} orderId=${orderId}`);
    state.step = 'track_sent';
    orderState.set(txId, state);
  } catch (err) {
    console.error('[doTrack error]', err.response?.data || err.message);
  }
}

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_search
   Auto-triggers select with the first item from Pramaan BPP
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_search', async (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });

  const body  = req.body;
  const txId  = body?.context?.transaction_id;
  if (!txId) return;

  const bppId  = body?.context?.bpp_id  || '';
  const bppUri = body?.context?.bpp_uri || PRAMAAN_BPP;

  console.log(`[on_search] txId=${txId} bpp_id=${bppId}`);

  const catalog   = body?.message?.catalog;
  const providers = catalog?.['bpp/providers'] || [];

  const parsedItems = providers.flatMap(provider => {
    const providerName = provider.descriptor?.name || 'Unknown';
    return (provider.items || []).map(item => ({
      provider:   providerName,
      providerId: provider.id,
      locationId: provider.locations?.[0]?.id,
      itemId:     item.id,
      name:       item.descriptor?.name || '',
      price:      parseFloat(item.price?.value || 0),
      currency:   item.price?.currency || 'INR',
      unit:       (item.quantity?.unitized?.measure?.value || '') + ' ' + (item.quantity?.unitized?.measure?.unit || ''),
      available:  item.quantity?.available?.count !== '0',
      image:      item.descriptor?.images?.[0] || null,
      bppId,
      bppUri,
    }));
  });

  if (parsedItems.length > 0) {
    cache.store(txId, parsedItems);
    console.log(`[on_search] Stored ${parsedItems.length} items for txId=${txId}`);

    // Auto-select the first item from Pramaan BPP
    const pramaanItem = parsedItems.find(i => i.bppId && i.bppId.includes('pramaan')) || parsedItems[0];
    if (pramaanItem) {
      const state = orderState.get(txId) || {};
      state.bppUri = pramaanItem.bppUri;
      state.bppId  = pramaanItem.bppId;
      orderState.set(txId, state);

      // Small delay to ensure ACK is sent first
      setTimeout(() => doSelect(txId, pramaanItem, state.context), 500);
    }
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_select
   Auto-triggers init
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_select', async (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });

  const body = req.body;
  const txId = body?.context?.transaction_id;
  if (!txId) return;

  console.log(`[on_select] txId=${txId}`);

  // Extract quote from on_select
  const order = body?.message?.order;
  const quote = order?.quote || {};

  const state = orderState.get(txId);
  if (state) {
    state.quote    = quote;
    state.onSelect = order;
    state.step     = 'on_select_received';

    // Update provider/item from on_select if more details available
    if (order?.provider?.id) state.provider = { ...state.provider, id: order.provider.id };

    orderState.set(txId, state);

    // Auto-trigger init
    setTimeout(() => doInit(txId, state), 500);
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_init
   Auto-triggers confirm
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_init', async (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });

  const body = req.body;
  const txId = body?.context?.transaction_id;
  if (!txId) return;

  console.log(`[on_init] txId=${txId}`);

  const order        = body?.message?.order;
  const paymentTxnId = order?.payment?.transaction_id;

  const state = orderState.get(txId);
  if (state) {
    state.onInit       = order;
    state.paymentTxnId = paymentTxnId;
    state.quote        = order?.quote || state.quote;
    state.step         = 'on_init_received';
    orderState.set(txId, state);

    // Auto-trigger confirm
    setTimeout(() => doConfirm(txId, state), 500);
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_confirm
   Auto-triggers status + track
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_confirm', async (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });

  const body = req.body;
  const txId = body?.context?.transaction_id;
  if (!txId) return;

  const orderId = body?.message?.order?.id;
  console.log(`[on_confirm] txId=${txId} orderId=${orderId}`);

  const state = orderState.get(txId);
  if (state) {
    state.orderId   = orderId;
    state.onConfirm = body?.message?.order;
    state.step      = 'on_confirm_received';
    orderState.set(txId, state);

    // Always auto-trigger status + track (doStatus/doTrack fall back to txId if orderId is null)
    setTimeout(() => doStatus(txId, state), 500);
    setTimeout(() => doTrack(txId, state),  1500);
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_status
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_status', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });

  const txId = req.body?.context?.transaction_id;
  console.log(`[on_status] txId=${txId}`);

  if (txId) {
    const state = orderState.get(txId);
    if (state) {
      state.onStatus = req.body?.message?.order;
      state.step     = 'on_status_received';
      orderState.set(txId, state);
    }
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_track
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_track', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });

  const txId = req.body?.context?.transaction_id;
  console.log(`[on_track] txId=${txId}`);

  if (txId) {
    const state = orderState.get(txId);
    if (state) {
      state.onTrack = req.body?.message?.tracking;
      state.step    = 'on_track_received';
      orderState.set(txId, state);
    }
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_cancel   (for flows 2, 3A, 3B)
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_cancel', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  const txId = req.body?.context?.transaction_id;
  console.log(`[on_cancel] txId=${txId}`);
  if (txId) {
    const state = orderState.get(txId);
    if (state) { state.onCancel = req.body?.message?.order; state.step = 'on_cancel_received'; orderState.set(txId, state); }
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_update   (for return flows 4A, 4B)
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_update', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  const txId = req.body?.context?.transaction_id;
  console.log(`[on_update] txId=${txId}`);
  if (txId) {
    const state = orderState.get(txId);
    if (state) { state.onUpdate = req.body?.message?.order; state.step = 'on_update_received'; orderState.set(txId, state); }
  }
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_rating
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_rating', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  console.log(`[on_rating] txId=${req.body?.context?.transaction_id}`);
});

/* ════════════════════════════════════════════════════════════
   WEBHOOK: POST /ondc/on_support
   ════════════════════════════════════════════════════════════ */
app.post('/ondc/on_support', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  console.log(`[on_support] txId=${req.body?.context?.transaction_id}`);
});

/* ════════════════════════════════════════════════════════════
   START SERVER
   ════════════════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n🚀 NammaDeal Backend running on http://localhost:${PORT}`);
  console.log(`📡 ONDC Subscriber ID : ${process.env.ONDC_SUBSCRIBER_ID || '⚠️  Not set'}`);
  console.log(`🌐 ONDC Gateway       : ${GATEWAY_URL}`);
  console.log(`🧪 Pramaan BPP        : ${PRAMAAN_BPP}`);
  console.log(`\n📌 Endpoints ready:`);
  console.log(`   POST http://localhost:${PORT}/api/search`);
  console.log(`   GET  http://localhost:${PORT}/api/results/:txId`);
  console.log(`   GET  http://localhost:${PORT}/api/order-state/:txId`);
  console.log(`   POST http://localhost:${PORT}/ondc/on_search  (webhook)`);
  console.log(`\n💡 To expose publicly: npx ngrok http ${PORT}\n`);
});

module.exports = app;
