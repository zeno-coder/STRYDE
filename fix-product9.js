require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function fix() {
  const url = `https://api.unsplash.com/search/photos?query=college+backpack&per_page=1&orientation=squarish&client_id=${process.env.UNSPLASH_ACCESS_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  const imageUrl = data.results[0].urls.regular;
  await pool.query('UPDATE products SET image_url = $1 WHERE id = 9', [imageUrl]);
  console.log('Done! Product 9 image saved.');
  pool.end();
}

fix().catch(console.error);