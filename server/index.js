import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGODB_DB = process.env.MONGODB_DB || 'gratitude_wall';

const app = express();
app.use(cors({ origin: CORS_ORIGIN === '*' ? '*' : CORS_ORIGIN.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));

let db;
let usersCollection;
let projectsCollection;
let kudosCollection;

function signToken(user) {
  return jwt.sign({ id: user._id.toString(), login: user.login }, JWT_SECRET, { expiresIn: '7d' });
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await usersCollection.findOne({ _id: new ObjectId(decoded.id) });
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

    await usersCollection.updateOne(
      { github_id: profile.id },
      {
        $set: {
          login: profile.login,
          avatar_url: profile.avatar_url,
          name: profile.name || '',
          github_token: accessToken,
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );

    const user = await usersCollection.findOne({ github_id: profile.id });
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

    await projectsCollection.updateOne(
      { owner: repoInfo.owner.login, repo: repoInfo.name },
      {
        $setOnInsert: {
          owner: repoInfo.owner.login,
          repo: repoInfo.name,
          created_by: req.user._id,
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    const project = await projectsCollection.findOne({ owner: repoInfo.owner.login, repo: repoInfo.name });
    res.json({ id: project._id.toString(), owner: project.owner, repo: project.repo });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to create project.' });
  }
});

app.get('/projects/:owner/:repo', async (req, res) => {
  const { owner, repo } = req.params;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json({ id: project._id.toString(), owner: project.owner, repo: project.repo });
});

app.get('/projects/:owner/:repo/kudos', async (req, res) => {
  const { owner, repo } = req.params;
  const { sort = 'recent', tag, query } = req.query;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.json([]);

  const filter = { project_id: project._id };
  if (tag) filter.tag = tag;
  if (query) {
    const pattern = new RegExp(query, 'i');
    filter.$or = [{ name: pattern }, { handle: pattern }, { message: pattern }];
  }

  const sortOrder = sort === 'top'
    ? { boosts: -1, created_at: -1 }
    : { created_at: -1 };

  const rows = await kudosCollection
    .find(filter)
    .sort(sortOrder)
    .limit(120)
    .toArray();

  res.json(rows.map((row) => ({
    id: row._id.toString(),
    name: row.name,
    handle: row.handle,
    tag: row.tag,
    message: row.message,
    boosts: row.boosts,
    created_at: row.created_at,
  })));
});

app.post('/projects/:owner/:repo/kudos', authMiddleware, async (req, res) => {
  const { owner, repo } = req.params;
  const { name, handle = '', tag = 'docs', message } = req.body || {};
  if (!name || !message) return res.status(400).json({ error: 'name and message required.' });

  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    await ensureMaintainer(req.user, owner, repo);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  const doc = {
    project_id: project._id,
    name: name.slice(0, 80),
    handle: handle.slice(0, 40),
    tag: tag.slice(0, 30),
    message: message.slice(0, 400),
    boosts: 0,
    created_at: new Date(),
  };

  const result = await kudosCollection.insertOne(doc);
  res.status(201).json({
    id: result.insertedId.toString(),
    name: doc.name,
    handle: doc.handle,
    tag: doc.tag,
    message: doc.message,
    boosts: doc.boosts,
    created_at: doc.created_at,
  });
});

app.post('/projects/:owner/:repo/kudos/:id/boost', async (req, res) => {
  const { owner, repo, id } = req.params;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const updated = await kudosCollection.findOneAndUpdate(
    { _id: new ObjectId(id), project_id: project._id },
    { $inc: { boosts: 1 } },
    { returnDocument: 'after' }
  );

  if (!updated.value) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: updated.value._id.toString(),
    name: updated.value.name,
    handle: updated.value.handle,
    tag: updated.value.tag,
    message: updated.value.message,
    boosts: updated.value.boosts,
    created_at: updated.value.created_at,
  });
});

app.get('/projects/:owner/:repo/stats', async (req, res) => {
  const { owner, repo } = req.params;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.json({ totalKudos: 0, totalContributors: 0, topTag: null, weekCount: 0 });

  const totalKudos = await kudosCollection.countDocuments({ project_id: project._id });
  const totalContributorsAgg = await kudosCollection.aggregate([
    { $match: { project_id: project._id } },
    { $group: { _id: { name: '$name', handle: '$handle' } } },
    { $count: 'count' },
  ]).toArray();
  const totalContributors = totalContributorsAgg[0]?.count || 0;

  const topTagAgg = await kudosCollection.aggregate([
    { $match: { project_id: project._id } },
    { $group: { _id: '$tag', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 },
  ]).toArray();
  const topTag = topTagAgg[0]?._id || null;

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekCount = await kudosCollection.countDocuments({ project_id: project._id, created_at: { $gte: since } });

  res.json({ totalKudos, totalContributors, topTag, weekCount });
});

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(MONGODB_DB);
  usersCollection = db.collection('users');
  projectsCollection = db.collection('projects');
  kudosCollection = db.collection('kudos');

  await usersCollection.createIndex({ github_id: 1 }, { unique: true });
  await projectsCollection.createIndex({ owner: 1, repo: 1 }, { unique: true });
  await kudosCollection.createIndex({ project_id: 1, created_at: -1 });

  app.listen(PORT, () => {
    console.log(`Gratitude Wall API running on ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
