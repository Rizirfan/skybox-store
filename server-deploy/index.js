const express = require('express');
const cors = require('cors');
const pool = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const PORT = process.env.PORT || 4002;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({ dest: UPLOAD_DIR });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.resolve(UPLOAD_DIR)));

// Auth helper
function authMiddleware(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).send({ message: 'Missing token' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).send({ message: 'Invalid token' });
  }
}

// Register
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send({ message: 'Missing credentials' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, created_at', [email, hashed]);
    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.send({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error creating user' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).send({ message: 'Missing credentials' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).send({ message: 'Invalid credentials' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).send({ message: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.send({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error logging in' });
  }
});

// Get user data (folders + files)
app.get('/api/data', authMiddleware, async (req, res) => {
  try {
    const folders = await pool.query('SELECT * FROM folders WHERE user_id = $1 ORDER BY created_at', [req.user.id]);
    const files = await pool.query('SELECT * FROM files WHERE user_id = $1 ORDER BY created_at', [req.user.id]);
    res.send({ folders: folders.rows, files: files.rows });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error loading data' });
  }
});

// Create folder
app.post('/api/folders', authMiddleware, async (req, res) => {
  const { name, parentId } = req.body;
  if (!name) return res.status(400).send({ message: 'Missing folder name' });
  try {
    const result = await pool.query('INSERT INTO folders (user_id, name, parent_id) VALUES ($1, $2, $3) RETURNING *', [req.user.id, name, parentId || null]);
    res.send(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error creating folder' });
  }
});

// Delete folder
app.delete('/api/folders/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  try {
    await pool.query('DELETE FROM folders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error deleting folder' });
  }
});

// Rename folder
app.put('/api/folders/:id', authMiddleware, async (req, res) => {
  const id = req.params.id;
  const { name } = req.body;
  try {
    const result = await pool.query('UPDATE folders SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [name, id, req.user.id]);
    res.send(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error updating folder' });
  }
});

// Upload file
app.post('/api/files', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const file = req.file; // multer file
    const { folderId } = req.body;
    if (!file) return res.status(400).send({ message: 'Missing file' });
    const result = await pool.query('INSERT INTO files (user_id, name, mime_type, size, path, folder_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [req.user.id, file.originalname, file.mimetype, file.size, file.filename, folderId || null]);
    res.send(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error saving file' });
  }
});

// Download file
app.get('/api/files/:id/download', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query('SELECT * FROM files WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).send({ message: 'Not found' });
    const file = result.rows[0];
    const filepath = path.resolve(UPLOAD_DIR, file.path);
    res.download(filepath, file.name);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error downloading file' });
  }
});

// Preview file (serves inline for previews)
app.get('/api/files/:id/preview', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query('SELECT * FROM files WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).send({ message: 'Not found' });
    const file = result.rows[0];
    const filepath = path.resolve(UPLOAD_DIR, file.path);
    // Set headers to force inline display instead of download
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.sendFile(filepath);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error previewing file' });
  }
});

// Delete file
app.delete('/api/files/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await pool.query('DELETE FROM files WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
    if (result.rows.length === 0) return res.status(404).send({ message: 'Not found' });
    // Remove file from disk
    const filepath = path.join(UPLOAD_DIR, result.rows[0].path);
    fs.unlink(filepath, (err) => {
      if (err) console.warn('Failed to remove uploaded file', err.message);
    });
    res.send({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error deleting file' });
  }
});

// Toggle star
app.put('/api/files/:id/star', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    // Toggle
    const file = (await pool.query('SELECT starred FROM files WHERE id = $1 AND user_id = $2', [id, req.user.id])).rows[0];
    if (!file) return res.status(404).send({ message: 'Not found' });
    const updated = (await pool.query('UPDATE files SET starred = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [!file.starred, id, req.user.id])).rows[0];
    res.send(updated);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error updating star' });
  }
});

// Rename file
app.put('/api/files/:id', authMiddleware, async (req, res) => {
  try {
    const id = req.params.id;
    const { name } = req.body;
    const updated = (await pool.query('UPDATE files SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [name, id, req.user.id])).rows[0];
    res.send(updated);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error renaming file' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
