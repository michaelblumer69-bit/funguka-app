require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

const { moderateContent } = require('./moderation');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== CLOUDINARY CONFIG ====================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// ==================== SUPABASE / POSTGRESQL ====================
// Try connection pooler first (better for serverless), fallback to direct
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(poolConfig);

// Helper for queries with retry
async function query(text, params, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`DB query failed, retrying... (${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// ==================== INIT DATABASE ====================
async function initDatabase() {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      // Confessions table
      await query(`
        CREATE TABLE IF NOT EXISTS confessions (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          category TEXT NOT NULL,
          catLabel TEXT NOT NULL,
          preview TEXT NOT NULL,
          fullText TEXT NOT NULL,
          duration TEXT DEFAULT '2:00',
          audioUrl TEXT,
          plays INTEGER DEFAULT 0,
          reactions INTEGER DEFAULT 0,
          comments INTEGER DEFAULT 0,
          isFlagged BOOLEAN DEFAULT FALSE,
          flagReason TEXT,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Reactions table
      await query(`
        CREATE TABLE IF NOT EXISTS reactions (
          id SERIAL PRIMARY KEY,
          confessionId INTEGER NOT NULL REFERENCES confessions(id) ON DELETE CASCADE,
          sessionId TEXT NOT NULL,
          type TEXT DEFAULT 'feel',
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(confessionId, sessionId)
        )
      `);

      // Sessions table
      await query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id SERIAL PRIMARY KEY,
          sessionId TEXT UNIQUE NOT NULL,
          createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          lastActive TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Indexes for search performance
      await query(`CREATE INDEX IF NOT EXISTS idx_confessions_category ON confessions(category)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_confessions_flagged ON confessions(isFlagged)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_confessions_created ON confessions(createdAt DESC)`);
      await query(`CREATE INDEX IF NOT EXISTS idx_reactions_session ON reactions(sessionId)`);

      console.log('✅ Database initialized');
      return;
    } catch (err) {
      console.error(`Database init attempt ${attempt} failed:`, err.message);
      if (attempt === 5) {
        console.error('❌ Could not connect to database after 5 attempts');
        console.error('Please check your DATABASE_URL and ensure Supabase is accessible');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

// ==================== MIDDLEWARE ====================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'funguka-secret-key-change-in-production',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  },
  name: 'funguka.sid'
}));

app.use((req, res, next) => {
  if (!req.session.anonId) {
    req.session.anonId = uuidv4();
    query('INSERT INTO sessions (sessionId) VALUES ($1) ON CONFLICT DO NOTHING', [req.session.anonId]).catch(() => {});
  } else {
    query('UPDATE sessions SET lastActive = CURRENT_TIMESTAMP WHERE sessionId = $1', [req.session.anonId]).catch(() => {});
  }
  next();
});

// ==================== FILE UPLOAD ====================
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only audio files allowed'), false);
    }
  }
});

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, 'public')));

// ==================== SEED DATA ====================
async function seedData() {
  const result = await query('SELECT COUNT(*) as count FROM confessions');
  if (parseInt(result.rows[0].count) > 0) return;

  const seeds = [
    {
      title: "I Married My Brother and Didn't Know",
      category: "heartbreak",
      catLabel: "HEARTBREAK",
      preview: "I met my husband at a church conference. We fell in love. Got married. Had two kids. Ten years later, my mother-in-law dropped a photo album...",
      fullText: "I met my husband at a church conference. We fell in love. Got married. Had two kids. Ten years later, my mother-in-law dropped a photo album.\n\nI saw a baby picture of my husband. Next to it... a baby picture of me. Same hospital. Same date.\n\nWe were twins. Separated at birth. Sold to different families. I've been married to my own brother for ten years.\n\nOur children... I don't know how to tell him. I don't know how to tell anyone. I've been carrying this for three months and I think I'm going to lose my mind.",
      duration: "2:34",
      plays: 124000,
      reactions: 8200
    },
    {
      title: "I Stole $40,000 From My Dying Mother",
      category: "crime",
      catLabel: "CRIME",
      preview: "She had dementia. She didn't know who I was. Her account had $40,000 sitting there for years. I transferred it to myself the week before she died...",
      fullText: "She had dementia. She didn't know who I was. Her account had $40,000 sitting there for years. I transferred it to myself the week before she died.\n\nI told myself it was inheritance. I told myself she would have wanted me to have it. But she was still breathing. She was still alive. And I took it while she stared at the wall not knowing her own name.\n\nI bought a car with it. I drive that car every day. Every time I start the engine, I hear her voice.",
      duration: "3:12",
      plays: 89000,
      reactions: 5100
    },
    {
      title: "I Pretended to Be Dead for Insurance Money",
      category: "crime",
      catLabel: "CRIME",
      preview: "My business was failing. $200,000 in debt. I faked my own death in a hiking accident. My wife collected the insurance. I watched my own funeral from a hotel room...",
      fullText: "My business was failing. $200,000 in debt. I faked my own death in a hiking accident. My wife collected the insurance. I watched my own funeral from a hotel room three blocks away.\n\nI saw my daughter cry over an empty casket. I saw my mother collapse. It's been two years. I live in another country now. My wife knows. She visits me twice a year. We never talk about it.\n\nMy daughter thinks I'm dead. She posts about missing her dad on Instagram. I like every post from a fake account.",
      duration: "4:05",
      plays: 256000,
      reactions: 18000
    },
    {
      title: "I Ruined My Best Friend's Life and They Don't Know",
      category: "regret",
      catLabel: "REGRET",
      preview: "I told their employer they were stealing. They weren't. I was jealous. They got fired, divorced, and had a breakdown. They still call me their best friend...",
      fullText: "I told their employer they were stealing. They weren't. I was jealous. They got promoted instead of me. So I sent an anonymous email.\n\nThey got fired within a week. Their spouse left them. They had a breakdown and spent three months in a facility. When they got out, I was the first person they called.\n\nThey still call me their best friend. It's been five years. We talk every day. I help them with job applications. I listen to them cry. And every single time, I know I'm the reason they're crying.",
      duration: "2:58",
      plays: 167000,
      reactions: 12000
    },
    {
      title: "I Have a Family Nobody Knows About",
      category: "wild",
      catLabel: "WILD",
      preview: "I've been married for 15 years. I have two kids with my wife. I also have three kids with another woman in a different city. I've been living a double life for 12 years...",
      fullText: "I've been married for 15 years. I have two kids with my wife. I also have three kids with another woman in a different city. I've been living a double life for 12 years.\n\nI work 'remotely' three days a week. Those days I'm at the other house. Both women think I travel for work. Both kids call me Dad. I have two birthdays, two Christmases, two of everything.\n\nI'm exhausted. I'm terrified. And I can't stop because I've built two lives and destroying either one will kill me.",
      duration: "3:45",
      plays: 312000,
      reactions: 24000
    },
    {
      title: "I Knew My Friend Was Going to Kill Themselves",
      category: "dark",
      catLabel: "DARK THOUGHTS",
      preview: "They told me in confidence. They made me promise not to tell anyone. I kept the promise. They're gone now. I could have stopped it. I didn't...",
      fullText: "They told me in confidence. They made me promise not to tell anyone. I kept the promise. They're gone now. I could have stopped it. I didn't.\n\nI tell myself they would have done it anyway. I tell myself they wanted to go. But I know — I KNOW — that if I had made one phone call, they'd still be here.\n\nI go to their grave every month. I never tell their family what I know. I carry the secret like a stone in my chest. Sometimes I think the weight of it will kill me too.",
      duration: "2:18",
      plays: 198000,
      reactions: 15000
    }
  ];

  for (const s of seeds) {
    await query(
      `INSERT INTO confessions (title, category, catLabel, preview, fullText, duration, plays, reactions) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [s.title, s.category, s.catLabel, s.preview, s.fullText, s.duration, s.plays, s.reactions]
    );
  }
  console.log('✅ Seed data inserted');
}

// ==================== API ROUTES ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get confessions (with filtering + pagination + SEARCH)
app.get('/api/confessions', async (req, res) => {
  try {
    const { category, page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE isFlagged = false';
    let countWhere = 'WHERE isFlagged = false';
    const params = [];
    let paramIndex = 1;

    if (category && category !== 'all') {
      whereClause += ` AND category = $${paramIndex}`;
      countWhere += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      whereClause += ` AND (title ILIKE $${paramIndex} OR preview ILIKE $${paramIndex} OR fullText ILIKE $${paramIndex} OR catLabel ILIKE $${paramIndex})`;
      countWhere += ` AND (title ILIKE $${paramIndex} OR preview ILIKE $${paramIndex} OR fullText ILIKE $${paramIndex} OR catLabel ILIKE $${paramIndex})`;
      params.push(searchTerm);
      paramIndex++;
    }

    const sql = `SELECT * FROM confessions ${whereClause} ORDER BY createdAt DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    const countSql = `SELECT COUNT(*) as total FROM confessions ${countWhere}`;

    const [rowsResult, countResult] = await Promise.all([
      query(sql, [...params, parseInt(limit), offset]),
      query(countSql, params.slice(0, paramIndex - 1))
    ]);

    const rows = rowsResult.rows;
    const countRow = countResult.rows[0];

    const confessionIds = rows.map(r => r.id);
    let userReactions = [];
    if (confessionIds.length > 0) {
      const placeholders = confessionIds.map((_, i) => `$${i + 2}`).join(',');
      const reactionResult = await query(
        `SELECT confessionId, type FROM reactions WHERE sessionId = $1 AND confessionId IN (${placeholders})`,
        [req.session.anonId, ...confessionIds]
      );
      userReactions = reactionResult.rows;
    }

    const reactedSet = new Set(userReactions.map(r => r.confessionid));

    res.json({
      confessions: rows.map(r => ({ ...r, userReacted: reactedSet.has(r.id) })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countRow.total),
        pages: Math.ceil(parseInt(countRow.total) / parseInt(limit))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch confessions' });
  }
});

// Get single confession
app.get('/api/confessions/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM confessions WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const row = result.rows[0];
    const reactionResult = await query(
      'SELECT type FROM reactions WHERE confessionId = $1 AND sessionId = $2',
      [req.params.id, req.session.anonId]
    );

    row.userReacted = reactionResult.rows.length > 0;
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch confession' });
  }
});

// Increment play count
app.post('/api/confessions/:id/play', async (req, res) => {
  try {
    await query('UPDATE confessions SET plays = plays + 1 WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plays' });
  }
});

// Add reaction
app.post('/api/confessions/:id/react', async (req, res) => {
  try {
    const { type = 'feel' } = req.body;
    const confessionId = parseInt(req.params.id);

    const existing = await query(
      'SELECT id FROM reactions WHERE confessionId = $1 AND sessionId = $2',
      [confessionId, req.session.anonId]
    );

    if (existing.rows.length > 0) {
      await query('DELETE FROM reactions WHERE id = $1', [existing.rows[0].id]);
      await query('UPDATE confessions SET reactions = reactions - 1 WHERE id = $1', [confessionId]);
      const countResult = await query('SELECT reactions FROM confessions WHERE id = $1', [confessionId]);
      res.json({ reacted: false, reactions: countResult.rows[0].reactions });
    } else {
      await query(
        'INSERT INTO reactions (confessionId, sessionId, type) VALUES ($1, $2, $3)',
        [confessionId, req.session.anonId, type]
      );
      await query('UPDATE confessions SET reactions = reactions + 1 WHERE id = $1', [confessionId]);
      const countResult = await query('SELECT reactions FROM confessions WHERE id = $1', [confessionId]);
      res.json({ reacted: true, reactions: countResult.rows[0].reactions });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process reaction' });
  }
});

// Get related confessions
app.get('/api/confessions/:id/related', async (req, res) => {
  try {
    const confessionResult = await query('SELECT category FROM confessions WHERE id = $1', [req.params.id]);
    if (confessionResult.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const category = confessionResult.rows[0].category;
    const result = await query(
      'SELECT * FROM confessions WHERE category = $1 AND id != $2 AND isFlagged = false ORDER BY RANDOM() LIMIT 3',
      [category, req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch related' });
  }
});

// Submit confession
app.post('/api/confessions', upload.single('audio'), async (req, res) => {
  try {
    const { title, category, fullText } = req.body;

    if (!title || !category || !fullText) {
      return res.status(400).json({ error: 'Title, category, and text are required' });
    }

    const moderation = moderateContent(fullText);

    if (moderation.shouldBlock) {
      console.log('🚫 BLOCKED confession:', moderation.flagReason);
      return res.status(403).json({ 
        error: 'This confession contains content that violates our guidelines and cannot be posted.',
        blocked: true 
      });
    }

    const catLabels = {
      heartbreak: 'HEARTBREAK',
      crime: 'CRIME',
      dark: 'DARK THOUGHTS',
      regret: 'REGRET',
      wild: 'WILD'
    };

    const preview = fullText.substring(0, 120) + (fullText.length > 120 ? '...' : '');
    const duration = req.file ? '0:45' : '1:20';

    let audioUrl = null;
    if (req.file) {
      try {
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          resource_type: 'video',
          folder: 'funguka-confessions',
          public_id: `confession-${Date.now()}`,
          overwrite: false
        });
        audioUrl = uploadResult.secure_url;
        fs.unlinkSync(req.file.path);
      } catch (cloudErr) {
        console.error('Cloudinary upload error:', cloudErr);
        fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: 'Failed to upload audio' });
      }
    }

    const result = await query(
      `INSERT INTO confessions (title, category, catLabel, preview, fullText, duration, audioUrl, isFlagged, flagReason) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [title, category, catLabels[category] || category.toUpperCase(), preview, fullText, duration, audioUrl, moderation.isFlagged, moderation.flagReason || null]
    );

    if (moderation.isFlagged) {
      console.log('⚠️ FLAGGED confession for review:', moderation.flagReason);
    }

    res.status(201).json({ 
      id: result.rows[0].id, 
      success: true,
      flagged: moderation.isFlagged,
      message: moderation.isFlagged ? 'Posted but flagged for review' : 'Confession released'
    });
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to submit confession' });
  }
});

// ==================== ADMIN ROUTES ====================

async function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  if (token !== process.env.ADMIN_TOKEN && token !== 'funguka-admin-2024') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

app.get('/api/admin/flagged', adminAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM confessions WHERE isFlagged = true ORDER BY createdAt DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch flagged' });
  }
});

app.post('/api/admin/flagged/:id', adminAuth, async (req, res) => {
  try {
    const { action } = req.body;
    if (action === 'approve') {
      await query('UPDATE confessions SET isFlagged = false, flagReason = NULL WHERE id = $1', [req.params.id]);
    } else {
      await query('DELETE FROM confessions WHERE id = $1', [req.params.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process' });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const total = await query('SELECT COUNT(*) as count FROM confessions');
    const flagged = await query('SELECT COUNT(*) as count FROM confessions WHERE isFlagged = true');
    const hidden = await query('SELECT COUNT(*) as count FROM confessions WHERE isFlagged = true');
    const totalPlays = await query('SELECT COALESCE(SUM(plays), 0) as total FROM confessions');
    const totalReactions = await query('SELECT COALESCE(SUM(reactions), 0) as total FROM confessions');
    const sessions = await query('SELECT COUNT(*) as count FROM sessions');

    res.json({
      totalConfessions: parseInt(total.rows[0].count),
      flaggedConfessions: parseInt(flagged.rows[0].count),
      totalPlays: parseInt(totalPlays.rows[0].total),
      totalReactions: parseInt(totalReactions.rows[0].total),
      uniqueSessions: parseInt(sessions.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get ALL confessions (including flagged/hidden) for admin
app.get('/api/admin/confessions', adminAuth, async (req, res) => {
  try {
    const result = await query('SELECT * FROM confessions ORDER BY createdAt DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch confessions' });
  }
});

// Delete a confession
app.delete('/api/admin/confessions/:id', adminAuth, async (req, res) => {
  try {
    // Get audio URL first to delete from Cloudinary
    const confession = await query('SELECT audioUrl FROM confessions WHERE id = $1', [req.params.id]);
    if (confession.rows.length > 0 && confession.rows[0].audiourl) {
      // Extract public_id from Cloudinary URL and delete
      try {
        const url = confession.rows[0].audiourl;
        const publicId = url.split('/').slice(-2).join('/').split('.')[0];
        await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
      } catch (e) {
        console.log('Could not delete from Cloudinary:', e.message);
      }
    }

    await query('DELETE FROM confessions WHERE id = $1', [req.params.id]);
    res.json({ success: true, message: 'Confession deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete confession' });
  }
});

// Toggle confession visibility (hide/show)
app.post('/api/admin/confessions/:id/toggle', adminAuth, async (req, res) => {
  try {
    const confession = await query('SELECT isFlagged FROM confessions WHERE id = $1', [req.params.id]);
    if (confession.rows.length === 0) {
      return res.status(404).json({ error: 'Confession not found' });
    }

    const newStatus = !confession.rows[0].isflagged;
    await query(
      'UPDATE confessions SET isFlagged = $1, flagReason = CASE WHEN $1 THEN $2 ELSE NULL END WHERE id = $3',
      [newStatus, newStatus ? 'Hidden by admin' : null, req.params.id]
    );

    res.json({ 
      success: true, 
      hidden: newStatus,
      message: newStatus ? 'Confession hidden' : 'Confession visible'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle visibility' });
  }
});

// ==================== ADMIN AUDIO UPLOAD ====================
app.post('/api/admin/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    const { confessionId } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    if (!confessionId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Confession ID required' });
    }

    // Upload to Cloudinary
    let audioUrl = null;
    try {
      const uploadResult = await cloudinary.uploader.upload(req.file.path, {
        resource_type: 'video',
        folder: 'funguka-confessions',
        public_id: `confession-${confessionId}-${Date.now()}`,
        overwrite: false
      });
      audioUrl = uploadResult.secure_url;
      fs.unlinkSync(req.file.path);
    } catch (cloudErr) {
      console.error('Cloudinary upload error:', cloudErr);
      fs.unlinkSync(req.file.path);
      return res.status(500).json({ error: 'Failed to upload to Cloudinary' });
    }

    // Update confession in database
    await query(
      'UPDATE confessions SET audioUrl = $1 WHERE id = $2',
      [audioUrl, confessionId]
    );

    res.json({ success: true, audioUrl });
  } catch (err) {
    console.error(err);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to process upload' });
  }
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File upload error: ' + err.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START ====================
initDatabase().then(() => {
  seedData().then(() => {
    // Admin: Delete confession
app.delete('/api/confessions/:id', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.params;
  try {
    // Get audio URL first to delete from Cloudinary
    const result = await pool.query('SELECT audio_url FROM confessions WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    const audioUrl = result.rows[0].audio_url;
    
    // Delete from Cloudinary if audio exists
    if (audioUrl && audioUrl.includes('cloudinary')) {
      try {
        const publicId = audioUrl.split('/').pop().split('.')[0];
        await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
      } catch (e) {
        console.log('Cloudinary delete skipped:', e.message);
      }
    }

    // Delete from database
    await pool.query('DELETE FROM confessions WHERE id = $1', [id]);
    res.status(204).send();
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Admin: Toggle hide/show
app.patch('/api/confessions/:id/hide', async (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.params;
  const { hidden } = req.body;
  try {
    await pool.query('UPDATE confessions SET hidden = $1 WHERE id = $2', [hidden, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Hide error:', err);
    res.status(500).json({ error: err.message });
  }
});app.listen(PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════╗');
      console.log('║         FUNGUKA IS LIVE v2.0             ║');
      console.log('║     Supabase + Cloudinary + Search       ║');
      console.log('║                                          ║');
      console.log(`║  🌐 http://localhost:${PORT}              ║`);
      console.log('╚══════════════════════════════════════════╝');
      console.log('');
    });
  });
});
