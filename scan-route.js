// scan-route.js  (v4 - multi-view Hunyuan3D on your free Modal endpoint)

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const MODAL_SCAN_URL = process.env.MODAL_SCAN_URL;
const SCAN_TOKEN = process.env.SCAN_TOKEN;

const MODELS_DIR = path.join(__dirname, 'public', 'models');
if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 4 }
});

const VIEW_FIELDS = upload.fields([
  { name: 'front', maxCount: 1 },
  { name: 'left', maxCount: 1 },
  { name: 'back', maxCount: 1 },
  { name: 'right', maxCount: 1 },
  { name: 'images', maxCount: 4 } // backwards compat
]);

module.exports = function (pool) {
  const router = express.Router();

  function adminAuth(req, res, next) {
    const token = req.headers['admin-token'];
    if (token === 'pass1234') return next();
    res.status(401).json({ error: 'Unauthorized' });
  }
  router.use(adminAuth);

  // ---- POST /api/scan/start ----
  router.post('/start', VIEW_FIELDS, async (req, res) => {
    try {
      if (!MODAL_SCAN_URL) {
        return res.status(500).json({ error: 'MODAL_SCAN_URL missing from .env' });
      }

      const files = req.files || {};
      // Old clients that still send an unlabeled 'images' array: treat first as front
      const front = files.front?.[0] || files.images?.[0];
      if (!front) {
        return res.status(400).json({ error: 'A front photo is required' });
      }

      const form = new FormData();
      const viewNames = [];
      for (const name of ['front', 'left', 'back', 'right']) {
        const f = name === 'front' ? front : files[name]?.[0];
        if (f) {
          form.append(name, new Blob([f.buffer], { type: f.mimetype }), `${name}.jpg`);
          viewNames.push(name);
        }
      }

      console.log(`[scan] Sending ${viewNames.length} view(s) [${viewNames.join(', ')}] to Modal GPU...`);
      console.log('[scan] Multi-view generation takes 2-5 min (plus ~1-2 min cold start if idle).');

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12 * 60 * 1000);

      const scanRes = await fetch(MODAL_SCAN_URL, {
        method: 'POST',
        headers: { 'x-scan-token': SCAN_TOKEN },
        body: form,
        signal: controller.signal
      }).finally(() => clearTimeout(timer));

      if (!scanRes.ok) {
        throw new Error(`Modal endpoint error ${scanRes.status}: ${await scanRes.text()}`);
      }

      const meshBuffer = Buffer.from(await scanRes.arrayBuffer());
      console.log(`[scan] Received .glb (${meshBuffer.length} bytes). Saving...`);

      const filename = `model-${Date.now()}.glb`;
      fs.writeFileSync(path.join(MODELS_DIR, filename), meshBuffer);
      const modelUrl = `/models/${filename}`;

      // ---- unchanged DB logic ----
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
          [productName, category || 'uncategorized', subcategory || null, description || null,
           price || 0, brand || null, color || null, size || null,
           parseInt(stock, 10) || 0, modelUrl]
        );
        productId = insert.rows[0].id;
      } else {
        await pool.query('UPDATE products SET model_url = $1 WHERE id = $2', [modelUrl, productId]);
      }

      res.json({ status: 'success', modelUrl, productId });
    } catch (err) {
      console.error('scan/start error:', err);
      const friendly = err.name === 'AbortError'
        ? 'Scan timed out after 12 minutes - check Modal dashboard logs and try again.'
        : err.message;
      res.status(500).json({ error: friendly });
    }
  });

  // ---- GET /api/scan/products ---- (unchanged)
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