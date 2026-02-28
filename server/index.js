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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSnapshotSvg({ owner, repo, kudos, settings }) {
  const width = 1200;
  const height = 630;
  const cardWidth = 340;
  const cardHeight = 140;
  const cols = 3;
  const gap = 20;
  const offsetX = 60;
  const offsetY = 150;
  const theme = settings?.theme || 'warm';
  const accent = settings?.accent || '#ff6a3d';
  const background = settings?.background || 'sunset';
  const backgrounds = {
    sunset: ['#FFF0E6', '#F6F3EF'],
    ocean: ['#DDF3FF', '#F3FBFF'],
    paper: ['#FBF7F2', '#F3E9DE'],
    neon: ['#1b1b2f', '#25274d'],
  };
  const base = backgrounds[background] || backgrounds.sunset;
  const bgStart = theme === 'midnight' ? '#0f141a' : base[0];
  const bgEnd = theme === 'midnight' ? '#1a1f26' : base[1];
  const defaultTitle = theme === 'midnight' ? '#f5f5f5' : '#161515';
  const defaultSubtitle = theme === 'midnight' ? '#c5c5c5' : '#5d5a56';
  const textMain = (theme === 'midnight' && settings?.titleColor === '#161515') ? defaultTitle : (settings?.titleColor || defaultTitle);
  const textSub = (theme === 'midnight' && settings?.subtitleColor === '#5d5a56') ? defaultSubtitle : (settings?.subtitleColor || defaultSubtitle);
  const cardText = settings?.cardTextColor || textMain;
  const cardSub = settings?.cardSubtextColor || textSub;
  const cardFill = theme === 'midnight' ? '#171c22' : '#ffffff';
  const cardStroke = theme === 'midnight' ? '#2a313a' : '#E2DBD3';

  const cards = kudos.slice(0, 10).map((entry, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = offsetX + col * (cardWidth + gap);
    const y = offsetY + row * (cardHeight + gap);
    const name = escapeXml(entry.name || 'Contributor');
    const handle = escapeXml(entry.handle || '');
    const message = escapeXml(entry.message || 'Thanks for your contributions!');
    const tag = escapeXml(entry.tag || 'community');
    const initials = escapeXml((entry.name || 'C').slice(0, 2).toUpperCase());
    const avatar = entry.avatar_url ? escapeXml(entry.avatar_url) : '';

    return `
      <g>
        <rect x="${x}" y="${y}" rx="18" ry="18" width="${cardWidth}" height="${cardHeight}" fill="${cardFill}" stroke="${cardStroke}" />
        <defs>
          <clipPath id="clip-${index}">
            <circle cx="${x + 28}" cy="${y + 36}" r="16" />
          </clipPath>
        </defs>
        ${avatar ? `<image href="${avatar}" x="${x + 12}" y="${y + 20}" width="32" height="32" clip-path="url(#clip-${index})" />` : `<circle cx="${x + 28}" cy="${y + 36}" r="16" fill="${accent}" opacity="0.9" />
        <text x="${x + 28}" y="${y + 41}" text-anchor="middle" font-family="'Space Grotesk', Arial" font-size="12" fill="#ffffff" font-weight="700">${initials}</text>`}
        <text x="${x + 56}" y="${y + 36}" font-family="'Space Grotesk', Arial" font-size="20" fill="${cardText}" font-weight="600">${name}</text>
        <text x="${x + 56}" y="${y + 62}" font-family="'Space Grotesk', Arial" font-size="14" fill="${cardSub}">${handle}</text>
        <text x="${x + 20}" y="${y + 92}" font-family="'Space Grotesk', Arial" font-size="14" fill="${cardText}">${message.slice(0, 40)}${message.length > 40 ? '…' : ''}</text>
        <text x="${x + 20}" y="${y + 118}" font-family="'Space Grotesk', Arial" font-size="12" fill="${accent}">#${tag}</text>
      </g>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bgStart}" />
        <stop offset="100%" stop-color="${bgEnd}" />
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${theme === 'midnight' ? '#ffffff' : '#161515'}" stroke-width="0.6" />
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)" />
    <rect width="100%" height="100%" fill="url(#grid)" opacity="0.08" />
    <text x="60" y="72" font-family="'Fraunces', Georgia" font-size="36" fill="${textMain}">${escapeXml(settings?.title || 'PR Gratitude Wall')}</text>
    <text x="60" y="104" font-family="'Space Grotesk', Arial" font-size="18" fill="${textSub}">${escapeXml(settings?.subtitle || `${owner}/${repo}`)}</text>
    ${cards || `<text x="60" y="200" font-family="'Space Grotesk', Arial" font-size="16" fill="${textSub}">No kudos yet. Maintainers can add the first.</text>`}
  </svg>`;
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

app.get('/github/repos', authMiddleware, async (req, res) => {
  try {
    const repos = await githubRequest('/user/repos?per_page=100&sort=updated', req.user.github_token);
    const allowed = repos.filter((repo) => repo.permissions?.admin || repo.permissions?.maintain || repo.permissions?.push);
    res.json(allowed.map((repo) => ({
      owner: repo.owner?.login,
      repo: repo.name,
      full_name: repo.full_name,
      private: repo.private,
      stars: repo.stargazers_count,
      description: repo.description || '',
      updated_at: repo.updated_at,
      language: repo.language || '',
    })));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to load repos.' });
  }
});

app.post('/projects/from-github', authMiddleware, async (req, res) => {
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
          settings: {
            theme: 'warm',
            accent: '#ff6a3d',
            layout: 'masonry',
            background: 'sunset',
            title: 'PR Gratitude Wall',
            subtitle: `${repoInfo.owner.login}/${repoInfo.name}`,
            titleColor: '#161515',
            subtitleColor: '#5d5a56',
            cardTextColor: '#161515',
            cardSubtextColor: '#5d5a56',
          },
          featured_ids: [],
        },
      },
      { upsert: true }
    );

    const project = await projectsCollection.findOne({ owner: repoInfo.owner.login, repo: repoInfo.name });
    const existingCount = await kudosCollection.countDocuments({ project_id: project._id });

    if (existingCount === 0) {
      const contributors = await githubRequest(`/repos/${owner}/${repo}/contributors?per_page=10`, req.user.github_token);
      const seedDocs = contributors.slice(0, 10).map((contrib) => ({
        project_id: project._id,
        name: contrib.login,
        handle: `@${contrib.login}`,
        tag: 'community',
        message: `Top contributor with ${contrib.contributions} contributions. Thank you!`,
        avatar_url: contrib.avatar_url,
        boosts: 0,
        created_at: new Date(),
      }));
      if (seedDocs.length) await kudosCollection.insertMany(seedDocs);
    }

    const wallUrl = `${FRONTEND_URL}/p/${project.owner}/${project.repo}`;
    const snapshotUrl = `${BACKEND_URL}/projects/${project.owner}/${project.repo}/snapshot.svg`;

    res.json({
      id: project._id.toString(),
      owner: project.owner,
      repo: project.repo,
      wall_url: wallUrl,
      snapshot_url: snapshotUrl,
      settings: project.settings || null,
      featured_ids: project.featured_ids?.map((id) => id.toString()) || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to create project.' });
  }
});

app.get('/projects/:owner/:repo', async (req, res) => {
  const { owner, repo } = req.params;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: project._id.toString(),
    owner: project.owner,
    repo: project.repo,
    settings: project.settings || null,
    featured_ids: project.featured_ids?.map((id) => id.toString()) || [],
  });
});

app.patch('/projects/:owner/:repo/settings', authMiddleware, async (req, res) => {
  const { owner, repo } = req.params;
  const { theme, accent, layout, background, title, subtitle, titleColor, subtitleColor, cardTextColor, cardSubtextColor } = req.body || {};
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    await ensureMaintainer(req.user, owner, repo);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  const nextSettings = {
    theme: theme || project.settings?.theme || 'warm',
    accent: accent || project.settings?.accent || '#ff6a3d',
    layout: layout || project.settings?.layout || 'masonry',
    background: background || project.settings?.background || 'sunset',
    title: title || project.settings?.title || 'PR Gratitude Wall',
    subtitle: subtitle || project.settings?.subtitle || `${owner}/${repo}`,
    titleColor: titleColor || project.settings?.titleColor || '#161515',
    subtitleColor: subtitleColor || project.settings?.subtitleColor || '#5d5a56',
    cardTextColor: cardTextColor || project.settings?.cardTextColor || '#161515',
    cardSubtextColor: cardSubtextColor || project.settings?.cardSubtextColor || '#5d5a56',
  };

  await projectsCollection.updateOne(
    { _id: project._id },
    { $set: { settings: nextSettings } }
  );

  res.json({ settings: nextSettings });
});

app.post('/projects/:owner/:repo/featured', authMiddleware, async (req, res) => {
  const { owner, repo } = req.params;
  const { kudosId } = req.body || {};
  if (!kudosId) return res.status(400).json({ error: 'kudosId required.' });
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    await ensureMaintainer(req.user, owner, repo);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  await projectsCollection.updateOne(
    { _id: project._id },
    { $addToSet: { featured_ids: new ObjectId(kudosId) } }
  );

  const updated = await projectsCollection.findOne({ _id: project._id });
  res.json({ featured_ids: updated.featured_ids?.map((id) => id.toString()) || [] });
});

app.delete('/projects/:owner/:repo/featured/:kudosId', authMiddleware, async (req, res) => {
  const { owner, repo, kudosId } = req.params;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  try {
    await ensureMaintainer(req.user, owner, repo);
  } catch (err) {
    return res.status(403).json({ error: err.message });
  }

  await projectsCollection.updateOne(
    { _id: project._id },
    { $pull: { featured_ids: new ObjectId(kudosId) } }
  );

  const updated = await projectsCollection.findOne({ _id: project._id });
  res.json({ featured_ids: updated.featured_ids?.map((id) => id.toString()) || [] });
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
    avatar_url: row.avatar_url,
    boosts: row.boosts,
    created_at: row.created_at,
  })));
});

app.get('/projects/:owner/:repo/snapshot.svg', async (req, res) => {
  const { owner, repo } = req.params;
  const project = await projectsCollection.findOne({ owner, repo });
  if (!project) return res.status(404).send('Not found');

  let featuredRows = [];
  if (project.featured_ids?.length) {
    featuredRows = await kudosCollection
      .find({ _id: { $in: project.featured_ids } })
      .toArray();
  }
  const remainingRows = await kudosCollection
    .find({ project_id: project._id, _id: { $nin: project.featured_ids || [] } })
    .sort({ boosts: -1, created_at: -1 })
    .limit(10)
    .toArray();

  const override = {
    theme: req.query.theme,
    accent: req.query.accent,
    background: req.query.background,
    title: req.query.title,
    subtitle: req.query.subtitle,
    titleColor: req.query.titleColor,
    subtitleColor: req.query.subtitleColor,
    cardTextColor: req.query.cardTextColor,
    cardSubtextColor: req.query.cardSubtextColor,
  };
  const settings = { ...(project.settings || {}), ...Object.fromEntries(Object.entries(override).filter(([, value]) => value)) };

  const svg = buildSnapshotSvg({
    owner,
    repo,
    kudos: [...featuredRows, ...remainingRows].slice(0, 10),
    settings,
  });
  res.set('Content-Type', 'image/svg+xml');
  res.send(svg);
});

app.post('/projects/:owner/:repo/kudos', authMiddleware, async (req, res) => {
  const { owner, repo } = req.params;
  const { name, handle = '', tag = 'docs', message, avatar_url } = req.body || {};
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
    avatar_url: avatar_url ? avatar_url.slice(0, 300) : '',
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
    avatar_url: doc.avatar_url,
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
    avatar_url: updated.value.avatar_url,
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
