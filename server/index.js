import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 4000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id INTEGER UNIQUE,
    login TEXT NOT NULL,
    avatar_url TEXT,
    name TEXT,
    github_token TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(owner, repo),
    FOREIGN KEY(created_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS kudos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    handle TEXT,
    tag TEXT NOT NULL,
    message TEXT NOT NULL,
    boosts INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
`);

const app = express();
app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));

function signToken(user) {
  return jwt.sign({ id: user.id, login: user.login }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, login, avatar_url, name, github_token FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

async function githubRequest(pathname, token) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'gratitude-wall',
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'GitHub request failed');
  }
  return response.json();
}

async function exchangeCode(code) {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: GITHUB_CLIENT_ID,
      client_secret: GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!response.ok) throw new Error('GitHub token exchange failed');
  const data = await response.json();
  if (!data.access_token) throw new Error('Missing access token');
  return data.access_token;
}

function ensureAuthConfig(req, res, next) {
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).json({ error: 'GitHub OAuth not configured.' });
  }
  return next();
}

async function ensureMaintainer(user, owner, repo) {
  if (!user.github_token) throw new Error('GitHub token missing.');
  const viewer = await githubRequest(`/repos/${owner}/${repo}/collaborators/${user.login}/permission`, user.github_token);
  const perm = viewer?.permission;
  if (!['admin', 'maintain', 'write'].includes(perm)) {
    throw new Error('You must be a maintainer to manage this wall.');
  }
  return perm;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/auth/github', ensureAuthConfig, (req, res) => {
  const redirect = encodeURIComponent(`${FRONTEND_URL}/auth/callback`);
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&scope=repo&redirect_uri=${encodeURIComponent(`${BACKEND_URL}/auth/github/callback`)}&state=${redirect}`;
  res.redirect(url);
});

app.get('/auth/github/callback', ensureAuthConfig, async (req, res) => {
  try {
    const { code, state } = req.query;
    const accessToken = await exchangeCode(code);
    const profile = await githubRequest('/user', accessToken);

    const stmt = db.prepare(`
      INSERT INTO users (github_id, login, avatar_url, name, github_token)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, avatar_url=excluded.avatar_url, name=excluded.name, github_token=excluded.github_token
    `);
    stmt.run(profile.id, profile.login, profile.avatar_url, profile.name || '', accessToken);

    const user = db.prepare('SELECT * FROM users WHERE github_id = ?').get(profile.id);
    const token = signToken(user);

    const redirect = typeof state === 'string' ? decodeURIComponent(state) : `${FRONTEND_URL}/auth/callback`;
    const redirectUrl = new URL(redirect);
    redirectUrl.searchParams.set('token', token);
    redirectUrl.searchParams.set('login', user.login);
    res.redirect(redirectUrl.toString());
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/me', authMiddleware, (req, res) => {
  res.json({ login: req.user.login, avatar_url: req.user.avatar_url, name: req.user.name });
});

app.post('/projects', authMiddleware, async (req, res) => {
  const { owner, repo } = req.body || {};
  if (!owner || !repo) return res.status(400).json({ error: 'owner and repo required.' });

  try {
    await ensureMaintainer(req.user, owner, repo);
    const repoInfo = await githubRequest(`/repos/${owner}/${repo}`, req.user.github_token);

    const insert = db.prepare(`
      INSERT INTO projects (owner, repo, created_by)
      VALUES (?, ?, ?)
      ON CONFLICT(owner, repo) DO NOTHING
    `);
    insert.run(repoInfo.owner.login, repoInfo.name, req.user.id);

    const project = db.prepare('SELECT * FROM projects WHERE owner = ? AND repo = ?').get(repoInfo.owner.login, repoInfo.name);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to create project.' });
  }
});

app.get('/projects/:owner/:repo', (req, res) => {
  const { owner, repo } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE owner = ? AND repo = ?').get(owner, repo);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(project);
});

app.get('/projects/:owner/:repo/kudos', (req, res) => {
  const { owner, repo } = req.params;
  const { sort = 'recent', tag, query } = req.query;
  const project = db.prepare('SELECT * FROM projects WHERE owner = ? AND repo = ?').get(owner, repo);
  if (!project) return res.json([]);

  const clauses = ['project_id = ?'];
  const params = [project.id];

  if (tag) {
    clauses.push('tag = ?');
    params.push(tag);
  }

  if (query) {
    clauses.push('(name LIKE ? OR handle LIKE ? OR message LIKE ?)');
    const pattern = `%${query}%`;
    params.push(pattern, pattern, pattern);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const order = sort === 'top'
    ? 'ORDER BY boosts DESC, datetime(created_at) DESC'
    : 'ORDER BY datetime(created_at) DESC';

  const rows = db.prepare(`
    SELECT id, name, handle, tag, message, boosts, created_at
    FROM kudos
    ${where}
    ${order}
    LIMIT 120
  `).all(...params);

  res.json(rows);
});

app.post('/projects/:owner/:repo/kudos', authMiddleware, async (req, res) => {
  const { owner, repo } = req.params;
  const { name, handle = '', tag = 'docs', message } = req.body || {};
  if (!name || !message) return res.status(400).json({ error: 'name and message required.' });

  const project = db.prepare('SELECT * FROM projects WHERE owner = ? AND repo = ?').get(owner, repo);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    await ensureMaintainer(req.user, owner, repo);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  const stmt = db.prepare(`
    INSERT INTO kudos (project_id, name, handle, tag, message, boosts)
    VALUES (?, ?, ?, ?, ?, 0)
  `);
  const info = stmt.run(project.id, name.slice(0, 80), handle.slice(0, 40), tag.slice(0, 30), message.slice(0, 400));
  const row = db.prepare('SELECT * FROM kudos WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.post('/projects/:owner/:repo/kudos/:id/boost', (req, res) => {
  const { owner, repo, id } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE owner = ? AND repo = ?').get(owner, repo);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const stmt = db.prepare('UPDATE kudos SET boosts = boosts + 1 WHERE id = ? AND project_id = ?');
  const info = stmt.run(id, project.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Not found' });
  const row = db.prepare('SELECT * FROM kudos WHERE id = ?').get(id);
  res.json(row);
});

app.get('/projects/:owner/:repo/stats', (req, res) => {
  const { owner, repo } = req.params;
  const project = db.prepare('SELECT * FROM projects WHERE owner = ? AND repo = ?').get(owner, repo);
  if (!project) return res.json({ totalKudos: 0, totalContributors: 0, topTag: null, weekCount: 0 });

  const totalKudos = db.prepare('SELECT COUNT(*) as count FROM kudos WHERE project_id = ?').get(project.id).count;
  const totalContributors = db.prepare('SELECT COUNT(DISTINCT name || handle) as count FROM kudos WHERE project_id = ?').get(project.id).count;
  const topTagRow = db.prepare('SELECT tag, COUNT(*) as count FROM kudos WHERE project_id = ? GROUP BY tag ORDER BY count DESC LIMIT 1').get(project.id);
  const weekCount = db.prepare("SELECT COUNT(*) as count FROM kudos WHERE project_id = ? AND datetime(created_at) >= datetime('now','-7 days')").get(project.id).count;

  res.json({
    totalKudos,
    totalContributors,
    topTag: topTagRow?.tag || null,
    weekCount,
  });
});

app.listen(PORT, () => {
  console.log(`Gratitude Wall API running on ${PORT}`);
});
