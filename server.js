require('dotenv').config();
const express = require('express');
const Groq = require('groq-sdk');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');

const app = express();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `You are Sam, a friendly and helpful store assistant at Stryde, an affordable shop in Kerala that sells:
- Footwear: Crocs(id:1), school shoes(id:2), women's footwear(id:3), men's footwear(id:4), kids footwear(id:5)
- Bags: School bags(id:6), women's handbags(id:7)
- Waist belts(id:8), Umbrellas(id:9), Caps(id:10)

When recommending products, always end your reply with this exact format on a new line:
PRODUCTS:[1,2,3]

Only include IDs of products you actually mentioned. If no specific products mentioned, use PRODUCTS:[]

Keep responses short, warm and helpful — 2 to 3 sentences. Speak like a friendly shopkeeper.`;

// Try Groq first
async function tryGroq(messages) {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }))
    ]
  });
  return response.choices[0].message.content;
}

// Fallback to Gemini
async function tryGemini(messages) {
  const history = messages.slice(0, -1).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  const chat = gemini.chats.create({
    model: 'gemini-2.0-flash',
    config: { systemInstruction: SYSTEM_PROMPT },
    history: history
  });

  const lastMessage = messages[messages.length - 1].content;
  const response = await chat.sendMessage({ message: lastMessage });
  return response.text;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/chat', async (req, res) => {
  const { messages } = req.body;

  try {
    const validMessages = messages.filter(msg => msg.content && msg.content.trim() !== '');

    let reply;
    let provider;

    try {
      reply = await tryGroq(validMessages);
      provider = 'groq';
    } catch (groqError) {
      console.log('Groq failed, switching to Gemini...', groqError.message);
      try {
        reply = await tryGemini(validMessages);
        provider = 'gemini';
      } catch (geminiError) {
        console.log('Gemini also failed:', geminiError.message);
        throw new Error('All providers failed');
      }
    }

    console.log(`Reply sent via ${provider}`);
    res.json({ reply });

  } catch (error) {
    console.error('All AI providers failed:', error.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
});

app.listen(3000, () => {
  console.log('Stryde server running on http://localhost:3000');
});