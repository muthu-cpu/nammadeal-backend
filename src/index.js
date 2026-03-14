/**
 * NammaDeal Backend — Main Express Server
 * ═══════════════════════════════════════════════════════════════
 * Routes:
 *   POST /api/search          ← App calls this to start a search
 *   GET  /api/results/:txId   ← App polls this for price results
 *
 * ONDC Webhook Callbacks (called by ONDC Gateway):
 *   POST /ondc/on_search      ← Seller prices arrive here
 *   POST /ondc/on_select      ← Exact price breakdown
 *   POST /ondc/on_init
 *   POST /ondc/on_confirm
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const { createAuthHeader } = require('./ondcCrypto');
const { buildSearchPayload } = require('./ondcMessages');
const cache = require('./resultCache');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// Middleware: log all requests
// ─────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'NammaDeal Backend',
    version: '1.0.0',
    ondc_subscriber: process.env.ONDC_SUBSCRIBER_ID || 'not set',
    time: new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────────────────────
// POST /api/search
// Called by NammaDeal app to initiate a price search on ONDC.
// Body: { query, domain, location: { lat, lng } }
// Returns: { transactionId } — app then polls /api/results/:txId
// ─────────────────────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const { query, domain = 'grocery', location } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  try {
    const payload   = buildSearchPayload({ query, domain, location });
    const txId      = payload.context.transaction_id;
    const bodyStr   = JSON.stringify(payload);
    const authHeader = createAuthHeader(bodyStr);

    const gatewayUrl = process.env.ONDC_GATEWAY_URL || 'https://staging.registry.ondc.org/ondc';

    // Send to ONDC Gateway (fire and forget — responses come to /ondc/on_search)
    axios.post(`${gatewayUrl}/search`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      timeout: 10000,
    }).catch(err => {
      console.error('[ONDC Search Error]', err.response?.data || err.message);
    });

    console.log(`[Search] txId=${txId} query="${query}" domain=${domain}`);

    // Return txId immediately — app polls for results
    res.json({
      transactionId: txId,
      message: 'Search sent to ONDC. Poll /api/results/' + txId + ' for prices.',
    });

  } catch (err) {
    console.error('[/api/search error]', err.message);
    // If ONDC fails, fall back to static estimates
    res.status(200).json({
      transactionId: null,
      fallback: true,
      message: 'ONDC unavailable. Using local price estimates.',
    });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/results/:transactionId
// App polls this (every 1.5s for up to 10s) to get ONDC results.
// Returns: { results: [...sellers], count: n, done: bool }
// ─────────────────────────────────────────────────────────────
app.get('/api/results/:txId', (req, res) => {
  const results = cache.get(req.params.txId);
  if (!results) {
    return res.json({ results: [], count: 0, done: false });
  }
  res.json({
    results,
    count: results.length,
    done: true,
  });
});

// ─────────────────────────────────────────────────────────────
// ONDC WEBHOOK: POST /ondc/on_search
// ONDC Gateway calls this for each seller's price response.
// Multiple calls per search (one per seller platform).
// ─────────────────────────────────────────────────────────────
app.post('/ondc/on_search', (req, res) => {
  // Always ACK immediately (ONDC requires fast response)
  res.json({ message: { ack: { status: 'ACK' } } });

  const body = req.body;
  const txId  = body?.context?.transaction_id;
  if (!txId) return;

  console.log(`[on_search] txId=${txId} bpp_id=${body?.context?.bpp_id}`);

  // Parse sellers and items from response
  const catalog  = body?.message?.catalog;
  const providers = catalog?.['bpp/providers'] || [];

  const parsedItems = providers.flatMap(provider => {
    const providerName = provider.descriptor?.name || 'Unknown';
    const items = provider.items || [];
    return items.map(item => ({
      provider:    providerName,
      providerId:  provider.id,
      locationId:  provider.locations?.[0]?.id,
      itemId:      item.id,
      name:        item.descriptor?.name || '',
      price:       parseFloat(item.price?.value || 0),
      currency:    item.price?.currency || 'INR',
      unit:        item.quantity?.unitized?.measure?.value + ' ' + item.quantity?.unitized?.measure?.unit || '',
      available:   item.quantity?.available?.count !== '0',
      image:       item.descriptor?.images?.[0] || null,
      bppId:       body?.context?.bpp_id,
      bppUri:      body?.context?.bpp_uri,
    }));
  });

  if (parsedItems.length > 0) {
    cache.store(txId, parsedItems);
    console.log(`[on_search] Stored ${parsedItems.length} items for txId=${txId}`);
  }
});

// ─────────────────────────────────────────────────────────────
// ONDC WEBHOOK: POST /ondc/on_select
// ─────────────────────────────────────────────────────────────
app.post('/ondc/on_select', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  console.log('[on_select]', JSON.stringify(req.body?.context));
});

// ─────────────────────────────────────────────────────────────
// ONDC WEBHOOK: POST /ondc/on_init
// ─────────────────────────────────────────────────────────────
app.post('/ondc/on_init', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  console.log('[on_init]', JSON.stringify(req.body?.context));
});

// ─────────────────────────────────────────────────────────────
// ONDC WEBHOOK: POST /ondc/on_confirm
// ─────────────────────────────────────────────────────────────
app.post('/ondc/on_confirm', (req, res) => {
  res.json({ message: { ack: { status: 'ACK' } } });
  console.log('[on_confirm]', JSON.stringify(req.body?.context));
});

// ─────────────────────────────────────────────────────────────
// Start server
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NammaDeal Backend running on http://localhost:${PORT}`);
  console.log(`📡 ONDC Subscriber ID : ${process.env.ONDC_SUBSCRIBER_ID || '⚠️  Not set — run: npm run keygen'}`);
  console.log(`🌐 ONDC Gateway       : ${process.env.ONDC_GATEWAY_URL || 'https://staging.registry.ondc.org/ondc'}`);
  console.log(`\n📌 Endpoints ready:`);
  console.log(`   POST http://localhost:${PORT}/api/search`);
  console.log(`   GET  http://localhost:${PORT}/api/results/:txId`);
  console.log(`   POST http://localhost:${PORT}/ondc/on_search  (ONDC webhook)`);
  console.log(`\n💡 To expose publicly: npx ngrok http ${PORT}\n`);
});

module.exports = app;
