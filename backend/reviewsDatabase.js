const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'reviews.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let readyResolve;
let readyReject;
const ready = new Promise((resolve, reject) => {
  readyResolve = resolve;
  readyReject = reject;
});

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Reviews DB connection error:', err.message);
    readyReject(err);
    return;
  }

  console.log('Connected to reviews SQLite:', DB_PATH);
  db.serialize(() => {
    db.run('PRAGMA journal_mode=WAL');
    db.run('PRAGMA busy_timeout=5000');
    db.run(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rating INTEGER NOT NULL,
        name TEXT NOT NULL,
        contact TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'new',
        source TEXT DEFAULT 'site',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status)`, [], (indexErr) => {
      if (indexErr) readyReject(indexErr);
      else readyResolve();
    });
  });
});

function createReview(data) {
  return new Promise((resolve, reject) => {
    const { rating, name, contact, message, source = 'site' } = data;
    const sql = `
      INSERT INTO reviews (rating, name, contact, message, source)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [rating, name, contact, message, source], function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
  });
}

function getAllReviews(limit = 50, offset = 0) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT * FROM reviews
      ORDER BY created_at DESC
      LIMIT ?
      OFFSET ?
    `;

    db.all(sql, [limit, offset], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  db,
  ready,
  createReview,
  getAllReviews
};
