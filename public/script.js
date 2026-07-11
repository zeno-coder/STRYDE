let conversationHistory = [];
let allProducts = [];

// Load products from database
async function loadProducts() {
  try {
    const response = await fetch('/products');
    allProducts = await response.json();
  } catch (error) {
    console.error('Failed to load products:', error);
  }
}

// Parse Sam's reply — extract text and product IDs
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

// Show user message
function showUserMessage(text) {
  const main = document.querySelector('main');
  const div = document.createElement('div');
  div.className = 'user-message';
  div.innerHTML = `<span>${text}</span>`;
  main.appendChild(div);
  div.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

// Show Sam typing
function showTyping() {
  const replyEl = document.getElementById('samReply');
  replyEl.classList.add('visible');
  replyEl.innerHTML = `
    <div class="sam-name">Sam</div>
    <div class="typing"><span></span><span></span><span></span></div>
  `;
}

// Show Sam's reply
function showSamReply(text) {
  const replyEl = document.getElementById('samReply');
  replyEl.classList.add('visible');
  replyEl.innerHTML = `
    <div class="sam-name">Sam</div>
    ${text}
  `;
}

// Render products
function renderProducts(ids) {
  const area = document.getElementById('productsArea');

  if (!ids || ids.length === 0) {
    return;
  }

  const matched = allProducts.filter(p => ids.includes(p.id));

 area.innerHTML = matched.map((p, i) => `
   <div class="product-card" style="animation-delay: ${i * 0.05}s" onclick="window.location.href='product.html?id=${p.id}'">
      ${p.image_url
        ? `<img src="${p.image_url}" alt="${p.name}" class="product-img" />`
        : `<div class="product-emoji">${p.icon}</div>`
      }
      <div class="product-info">
        <div class="product-tag">${p.subcategory || p.category}</div>
        <div class="product-name">${p.name}</div>
        <div class="product-price">${p.price.replace(/\?/g, '₹')}</div>
        <div class="product-stock">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</div>
      </div>
    </div>
  `).join('');

  // Scroll to products
  setTimeout(() => {
    area.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// Set quick replies
function setQuickReplies(replies) {
  const el = document.getElementById('quickReplies');
  el.innerHTML = replies.map(r =>
    `<button class="qr-btn" onclick="sendMessage('${r}')">${r}</button>`
  ).join('');
}

// Send message
async function sendMessage(text) {
  const input = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');
  const message = text || input.value.trim();
  if (!message) return;

  // Hide greeting
  document.getElementById('samGreeting').classList.add('hidden');

  input.value = '';
  input.style.height = 'auto';
  btn.disabled = true;
  document.getElementById('quickReplies').innerHTML = '';

  showUserMessage(message);
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

    showSamReply(replyText);
    renderProducts(ids);
    setQuickReplies(['Show me bags', 'I need footwear', 'What umbrellas do you have?']);

  } catch (error) {
    showSamReply('Sorry, something went wrong. Please try again!');
  }

  btn.disabled = false;
  input.focus();
}

// Handle enter key
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto resize textarea
document.getElementById('chatInput').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = this.scrollHeight + 'px';
});

document.getElementById('sendBtn').addEventListener('click', () => sendMessage());

// Init
loadProducts();
setTimeout(() => {
  setQuickReplies(['I need shoes', 'Show me bags', 'What do you sell?']);
}, 500);