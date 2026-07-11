require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const { GoogleGenAI } = require('@google/genai');
const { Pool } = require('pg');
const path = require('path');

const app = express();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Database connection failed:', err.message);
  } else {
    console.log('Database connected successfully');
    release();
  }
});

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const scanRoutes = require('./scan-route')(pool);
app.use('/api/scan', scanRoutes);

async function buildSystemPrompt() {
  const result = await pool.query(
    'SELECT * FROM products WHERE active = true ORDER BY id'
  );
  const products = result.rows;

  const productList = products.map(p =>
    `- ${p.name} (id:${p.id}) | Category: ${p.category} | ${p.description} | Price: ${p.price} | Stock: ${p.stock} units`
  ).join('\n');

  return `You are Sam — not a chatbot, not just a website, but both at once. You are the living presence of Stryde, an affordable store in Kerala that sells footwear, bags, belts, umbrellas and caps.

You think like a smart salesperson who has worked in this store for years. You read what the customer actually means, not just what they literally say. When a mother says "my son is starting school next week" you immediately know she needs school shoes and a school bag. You don't ask her five questions — you show her what she needs.

Your personality:
- Warm, confident and natural — like a helpful friend, not a formal assistant
- You act fast — when you understand what someone needs, you show it immediately
- You never ask more than one question at a time
- You never ask something obvious — if someone says "I need shoes for my kid" you don't ask "are you looking for footwear?" — you already know
- You speak naturally, mix of friendly English is fine, short sentences
- You are the store — you know every product, every price, every stock level

Store inventory:
${productList}

CRITICAL RULES:
1. When you understand what the customer needs — even partially — immediately show those products using PRODUCTS:[ids]
2. Never show PRODUCTS:[] if you have any idea what they might want
3. If stock is 0, say so honestly and suggest an alternative
4. End EVERY reply with PRODUCTS:[ids] — always, no exceptions
5. Maximum 2-3 sentences before showing products
6. Never pepper the customer with multiple questions — one question max, and only when you truly have no idea what they need`;
}

async function tryGroq(messages, systemPrompt) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ]
  });
  return response.choices[0].message.content;
}

async function tryGemini(messages, systemPrompt) {
  const history = messages.slice(0, -1).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  const chat = gemini.chats.create({
    model: 'gemini-2.0-flash',
    config: { systemInstruction: systemPrompt },
    history: history
  });

  const lastMessage = messages[messages.length - 1].content;
  const response = await chat.sendMessage({ message: lastMessage });
  return response.text;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/products', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM products WHERE active = true ORDER BY id'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Failed to fetch products:', error.message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    const validMessages = messages.filter(msg => msg.content && msg.content.trim() !== '');
    const systemPrompt = await buildSystemPrompt();

    let reply;
    let provider;

    try {
      reply = await tryGroq(validMessages, systemPrompt);
      provider = 'groq';
    } catch (groqError) {
      console.log('Groq failed, switching to Gemini...', groqError.message);
      try {
        reply = await tryGemini(validMessages, systemPrompt);
        provider = 'gemini';
      } catch (geminiError) {
        console.log('Gemini also failed:', geminiError.message);
        throw new Error('All providers failed');
      }
    }

    console.log(`Reply sent via ${provider}`);
    res.json({ reply });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

const multer = require('multer');
const fs = require('fs');

// Create uploads folder if it doesn't exist
if (!fs.existsSync('./public/uploads')) {
  fs.mkdirSync('./public/uploads');
}

// Image upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './public/uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Simple auth middleware
function adminAuth(req, res, next) {
  const token = req.headers['admin-token'];
  if (token === 'pass1234') return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Get all products for admin
app.get('/admin/products', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new product
app.post('/admin/products', adminAuth, upload.single('image'), async (req, res) => {
  try {
    const { name, category, subcategory, description, price, brand, color, size, stock } = req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO products (name, category, subcategory, description, price, brand, color, size, stock, image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, category, subcategory, description, price, brand, color, size, parseInt(stock), image_url]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit product
app.put('/admin/products/:id', adminAuth, upload.single('image'), async (req, res) => {
  try {
    const { name, category, subcategory, description, price, brand, color, size, stock } = req.body;
    const { id } = req.params;

    let image_url = req.body.existing_image;
    if (req.file) image_url = `/uploads/${req.file.filename}`;

    const result = await pool.query(
      `UPDATE products SET name=$1, category=$2, subcategory=$3, description=$4,
       price=$5, brand=$6, color=$7, size=$8, stock=$9, image_url=$10,
       updated_at=CURRENT_TIMESTAMP WHERE id=$11 RETURNING *`,
      [name, category, subcategory, description, price, brand, color, size, parseInt(stock), image_url, parseInt(id)]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete product
app.delete('/admin/products/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update stock only
app.patch('/admin/products/:id/stock', adminAuth, async (req, res) => {
  try {
    const { stock } = req.body;
    const result = await pool.query(
      'UPDATE products SET stock=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *',
      [parseInt(stock), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.listen(3000, () => {
  console.log('Stryde server running on http://localhost:3000');
});