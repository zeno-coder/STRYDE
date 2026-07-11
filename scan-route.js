// scan-route.js
// Free image-to-3D pipeline using Stability AI's TripoSR model, hosted for
// free on Hugging Face Spaces (https://huggingface.co/spaces/stabilityai/TripoSR).
//
// Wire this into server.js with:
//   const scanRoutes = require('./scan-route')(pool);
//   app.use('/api/scan', scanRoutes);
//
// Requires: npm install multer @gradio/client
//
// IMPORTANT - verified against TripoSR's actual app.py source on Hugging Face
// (huggingface.co/spaces/stabilityai/TripoSR/blob/main/app.py). If Stability AI
// changes that Space's code later, the endpoint names below ("/preprocess",
// "/generate") or their parameter order could change too. To re-check: open
// the Space, footer -> "Use via API", or just re-read app.py's gr.Blocks()
// section at the bottom, which lists every `inputs=[...]` in order.
//
// Known limitation of the free tier: this Space runs on Hugging Face's
// "ZeroGPU" (allocates a GPU per request), so it can be slow to spin up and
// occasionally returns 503s under load. No uptime guarantee, unlike a paid API.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const HF_SPACE = 'stabilityai/TripoSR';
const HF_TOKEN = process.env.HF_TOKEN; // optional but recommended - better rate limits

const MODELS_DIR = path.join(__dirname, 'public', 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 4 }
});

module.exports = function (pool) {
  const router = express.Router();

  function adminAuth(req, res, next) {
    const token = req.headers['admin-token'];
    if (token === 'pass1234') return next();
    res.status(401).json({ error: 'Unauthorized' });
  }
  router.use(adminAuth);

  // ---- POST /api/scan/start ----
  router.post('/start', upload.array('images', 4), async (req, res) => {
    try {
      const files = req.files || [];
      if (files.length === 0) {
        return res.status(400).json({ error: 'At least one photo (front view) is required' });
      }
      const frontPhoto = files[0];
      console.log(`[scan] Received photo (${frontPhoto.size} bytes), connecting to TripoSR Space...`);

      const { Client } = await import('@gradio/client');

      const app = await Client.connect(HF_SPACE, HF_TOKEN ? { hf_token: HF_TOKEN } : {});
      console.log('[scan] Connected. Starting preprocess...');

      const imageBlob = new Blob([frontPhoto.buffer], { type: frontPhoto.mimetype });

      const doRemoveBackground = true;
      const foregroundRatio = 0.85;
      const mcResolution = 256;

      // Free ZeroGPU Spaces can queue for a long time under load. Fail loudly
      // after 5 minutes instead of hanging forever with no feedback.
      function withTimeout(promise, ms, label) {
        return Promise.race([
          promise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timed out waiting for ${label} after ${ms / 1000}s - the free Space is likely overloaded, try again shortly`)), ms)
          )
        ]);
      }

      // Use submit() instead of predict() so we get live queue position/stage
      // updates printed to the terminal instead of a silent black box while we wait.
      async function runStep(apiName, args, stepLabel) {
        const job = app.submit(apiName, args);
        let finalData = null;
        for await (const msg of job) {
          if (msg.type === 'status') {
            const pos = msg.position != null ? ` | queue position ${msg.position}` : '';
            const eta = msg.eta != null ? ` | eta ${Math.round(msg.eta)}s` : '';
            console.log(`[scan] ${stepLabel}: ${msg.stage}${pos}${eta}`);
          } else if (msg.type === 'data') {
            finalData = msg.data;
          }
        }
        if (!finalData) throw new Error(`${stepLabel} finished without returning any data`);
        return finalData;
      }

      const preprocessData = await withTimeout(
        runStep('/preprocess', [imageBlob, doRemoveBackground, foregroundRatio], 'preprocess'),
        300000,
        'preprocess'
      );
      console.log('[scan] Preprocess done. Starting mesh generation (this is the slow step)...');
      const processedImage = preprocessData[0];

      const generateData = await withTimeout(
        runStep('/generate', [processedImage, mcResolution], 'generate'),
        300000,
        'generate'
      );
      console.log('[scan] Mesh generated. Downloading .glb...');
      // generate() returns [obj_file, glb_file] in that order.
      const meshEntry = generateData[1];

      if (!meshEntry || !meshEntry.url) {
        console.error('Unexpected TripoSR response shape:', JSON.stringify(generateData));
        return res.status(502).json({
          error: 'Model generated but the response shape was unexpected - check the server log just printed above for the raw response.'
        });
      }

      const meshRes = await fetch(meshEntry.url);
      if (!meshRes.ok) throw new Error(`Could not download generated mesh: ${meshRes.status}`);
      const meshBuffer = Buffer.from(await meshRes.arrayBuffer());

      const filename = `model-${Date.now()}.glb`;
      fs.writeFileSync(path.join(MODELS_DIR, filename), meshBuffer);
      const modelUrl = `/models/${filename}`;

      let productId = req.body.productId ? parseInt(req.body.productId, 10) : null;

      if (!productId) {
        const { productName, price, category, subcategory, description, brand, color, size, stock } = req.body;
        if (!productName) {
          return res.status(400).json({ error: 'productName is required when productId is not given' });
        }
        const insert = await pool.query(
          `INSERT INTO products
             (name, category, subcategory, description, price, brand, color, size, stock, image_url, model_url, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,true) RETURNING id`,
          [
            productName,
            category || 'uncategorized',
            subcategory || null,
            description || null,
            price || 0,
            brand || null,
            color || null,
            size || null,
            parseInt(stock, 10) || 0,
            modelUrl
          ]
        );
        productId = insert.rows[0].id;
      } else {
        await pool.query('UPDATE products SET model_url = $1 WHERE id = $2', [modelUrl, productId]);
      }

      res.json({ status: 'success', modelUrl, productId });
    } catch (err) {
      console.error('scan/start error:', err);
      const friendly = /503|overload|unavailable/i.test(err.message)
        ? 'The free 3D model service is temporarily overloaded. Wait a minute and try again.'
        : err.message;
      res.status(500).json({ error: friendly });
    }
  });

  // ---- GET /api/scan/products ----
  router.get('/products', async (req, res) => {
    try {
      const result = await pool.query('SELECT id, name, category, model_url FROM products ORDER BY name ASC');
      res.json(result.rows);
    } catch (err) {
      console.error('scan/products error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};