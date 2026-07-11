require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

// Search terms for each product id
const productSearchTerms = {
  1:  'crocs clog shoes',
  2:  'black school shoes kids',
  3:  'women sandals',
  4:  'women casual shoes',
  5:  'men sandals',
  6:  'men casual shoes',
  7:  'kids shoes colorful',
  8:  'kids school backpack',
  9:  'college backpack laptop bag',
  10: 'women handbag tote',
  11: 'men leather belt',
  12: 'women fashion belt',
  13: 'compact foldable umbrella',
  14: 'large umbrella rain',
  15: 'baseball cap hat'
};

async function fetchImage(searchTerm) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(searchTerm)}&per_page=1&orientation=squarish&client_id=${UNSPLASH_KEY}`;
  
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.results && data.results.length > 0) {
    return data.results[0].urls.regular;
  }
  return null;
}

async function seedImages() {
  console.log('Fetching images from Unsplash...\n');
  
  for (const [id, searchTerm] of Object.entries(productSearchTerms)) {
    try {
      const imageUrl = await fetchImage(searchTerm);
      
      if (imageUrl) {
        await pool.query(
          'UPDATE products SET image_url = $1 WHERE id = $2',
          [imageUrl, parseInt(id)]
        );
        console.log(`✓ Product ${id} — ${searchTerm}`);
      } else {
        console.log(`✗ Product ${id} — no image found`);
      }

      // Wait 300ms between requests to respect rate limits
      await new Promise(r => setTimeout(r, 300));

    } catch (error) {
      console.error(`Error for product ${id}:`, error.message);
    }
  }

  console.log('\nDone! All images saved to database.');
  pool.end();
}

seedImages();