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

app.listen(3000, () => {
  console.log('Stryde server running on http://localhost:3000');
});