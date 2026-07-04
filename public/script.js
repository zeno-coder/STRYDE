const PRODUCTS = [
  { id: 1, emoji: '👟', tag: 'Footwear', name: 'Crocs', desc: 'Comfortable and lightweight. Available in multiple colors.', price: 'Affordable', category: ['footwear', 'crocs', 'comfortable'] },
  { id: 2, emoji: '👞', tag: 'Footwear', name: 'School Shoes', desc: 'Durable black school shoes for kids and teens.', price: 'Affordable', category: ['footwear', 'school', 'kids'] },
  { id: 3, emoji: '👠', tag: 'Footwear', name: "Women's Footwear", desc: 'Sandals and shoes for women. Wide variety available.', price: 'Affordable', category: ['footwear', 'women', 'sandals', 'shoes'] },
  { id: 4, emoji: '👡', tag: 'Footwear', name: "Men's Footwear", desc: 'Sandals and shoes for men. Comfortable and stylish.', price: 'Affordable', category: ['footwear', 'men', 'sandals', 'shoes'] },
  { id: 5, emoji: '👶', tag: 'Footwear', name: "Kids Footwear", desc: 'Cute and durable footwear for little ones.', price: 'Affordable', category: ['footwear', 'kids', 'children'] },
  { id: 6, emoji: '🎒', tag: 'Bags', name: 'School Bags', desc: 'Sturdy school bags for kids and college students.', price: 'Affordable', category: ['bags', 'school', 'college', 'students'] },
  { id: 7, emoji: '👜', tag: 'Bags', name: "Women's Handbags", desc: 'Stylish handbags for everyday use.', price: 'Affordable', category: ['bags', 'women', 'handbag'] },
  { id: 8, emoji: '🧣', tag: 'Accessories', name: 'Waist Belts', desc: 'All kinds of waist belts for men and women.', price: 'Affordable', category: ['belts', 'waist', 'accessories'] },
  { id: 9, emoji: '🌂', tag: 'Accessories', name: 'Umbrellas', desc: 'All types of umbrellas. Perfect for Kerala rains.', price: 'Affordable', category: ['umbrella', 'rain', 'accessories'] },
  { id: 10, emoji: '🧢', tag: 'Accessories', name: 'Caps', desc: 'Small but stylish collection of caps.', price: 'Affordable', category: ['caps', 'hats', 'accessories'] },
];

let conversationHistory = [];

// Parse Sam's reply — extract text and product IDs separately
function parseReply(fullReply) {
  const match = fullReply.match(/PRODUCTS:\[([^\]]*)\]/);
  let ids = [];
  if (match) {
    ids = match[1]
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n));
  }
  const text = fullReply.replace(/PRODUCTS:\[([^\]]*)\]/, '').trim();
  return { text, ids };
}

// Render product cards, highlight the ones Sam recommended
function renderProducts(highlightIds = []) {
  const grid = document.getElementById('productsGrid');
  grid.innerHTML = PRODUCTS.map(p => `
    <div class="product-card ${highlightIds.includes(p.id) ? 'highlighted' : ''}">
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-info">
        <div class="product-tag">${p.tag}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-desc">${p.desc}</div>
        <div class="product-price">${p.price}</div>
      </div>
    </div>
  `).join('');

  // Scroll to first highlighted card
  if (highlightIds.length > 0) {
    setTimeout(() => {
      const first = document.querySelector('.product-card.highlighted');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}

function addMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.innerHTML = `
    ${role === 'sam' ? '<div class="msg-name">Sam</div>' : ''}
    <div class="msg-bubble">${text}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'msg sam';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="msg-name">Sam</div>
    <div class="msg-bubble">
      <div class="typing"><span></span><span></span><span></span></div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

function setQuickReplies(replies) {
  const el = document.getElementById('quickReplies');
  el.innerHTML = replies.map(r =>
    `<button class="qr-btn" onclick="sendMessage('${r}')">${r}</button>`
  ).join('');
}

async function sendMessage(text) {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');
  const message = text || input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;
  document.getElementById('quickReplies').innerHTML = '';

  addMessage('user', message);
  showTyping();

  conversationHistory.push({ role: 'user', content: message });

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory })
    });

    const data = await response.json();
    const { text: replyText, ids } = parseReply(data.reply);

    conversationHistory.push({ role: 'assistant', content: data.reply });

    removeTyping();
    addMessage('sam', replyText);
    renderProducts(ids);
    setQuickReplies(['Show me bags', 'I need footwear', 'What umbrellas do you have?']);

  } catch (error) {
    removeTyping();
    addMessage('sam', 'Sorry, something went wrong. Please try again!');
  }

  btn.disabled = false;
  input.focus();
}

document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('chatInput').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = this.scrollHeight + 'px';
});

document.getElementById('sendBtn').addEventListener('click', () => sendMessage());

renderProducts();
setTimeout(() => {
  addMessage('sam', "Hi there! Welcome to Stryde 👟 I'm Sam, your store assistant. Looking for footwear, bags, or accessories? Tell me what you need and I'll help you find it!");
  setQuickReplies(['I need shoes', 'Show me bags', 'What do you sell?']);
}, 500);