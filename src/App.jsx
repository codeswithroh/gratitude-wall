import { useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

const TAGS = [
  'docs',
  'bugfix',
  'refactor',
  'design',
  'mentoring',
  'community',
  'tooling',
  'testing',
];

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname || '/');

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = (next) => {
    if (next !== path) {
      window.history.pushState({}, '', next);
      setPath(next);
    }
  };

  return { path, go };
}

function parseProject(path) {
  const match = path.match(/^\/p\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function useAuth() {
  const [token, setToken] = useState(() => localStorage.getItem('gratitude_token') || '');
  const [user, setUser] = useState(null);

  const loadMe = async (nextToken = token) => {
    if (!nextToken) return;
    const response = await fetch(`${API_BASE}/me`, {
      headers: { Authorization: `Bearer ${nextToken}` },
    });
    if (!response.ok) {
      localStorage.removeItem('gratitude_token');
      setToken('');
      setUser(null);
      return;
    }
    const data = await response.json();
    setUser(data);
  };

  useEffect(() => {
    loadMe();
  }, [token]);

  const logout = () => {
    localStorage.removeItem('gratitude_token');
    setToken('');
    setUser(null);
  };

  return { token, setToken, user, logout, loadMe };
}

function Hero({ onConnect, user }) {
  return (
    <header className="hero">
      <div className="hero-top">
        <span className="pill">Maintainer Verified</span>
        <div className="hero-actions">
          {user ? (
            <div className="user-chip">
              <img src={user.avatar_url} alt={user.login} />
              <span>@{user.login}</span>
            </div>
          ) : (
            <button className="primary" onClick={onConnect}>Connect GitHub</button>
          )}
        </div>
      </div>
      <div className="hero-grid">
        <div>
          <h1>PR Gratitude Wall</h1>
          <p>
            A dedicated, project‑scoped wall to celebrate contributors. Maintainers authenticate with GitHub, create their wall, and share kudos that truly count.
          </p>
          <div className="hero-tags">
            {TAGS.map((tag) => (
              <span key={tag} className="tag">
                #{tag}
              </span>
            ))}
          </div>
        </div>
        <div className="spotlight">
          <div className="spotlight-label">Why This Works</div>
          <h2>Trust + Focus</h2>
          <p>
            Each wall is tied to a verified GitHub repo. Only maintainers can post kudos, making every thank‑you authentic and meaningful.
          </p>
          <ul>
            <li>Project‑scoped walls</li>
            <li>Maintainer‑only posting</li>
            <li>Beautiful public showcase</li>
          </ul>
        </div>
      </div>
    </header>
  );
}

function AuthCallback({ onToken }) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const error = params.get('error');
    if (token) {
      localStorage.setItem('gratitude_token', token);
      onToken(token);
      window.history.replaceState({}, '', '/');
    } else if (error) {
      window.history.replaceState({}, '', '/');
    }
  }, [onToken]);

  return (
    <div className="center-box">
      <h2>Connecting your GitHub…</h2>
      <p>Hang tight, we are securing your session.</p>
    </div>
  );
}

function Landing({ onConnect, onCreateWall, creating, error }) {
  const [repoInput, setRepoInput] = useState('');

  const handleCreate = () => {
    const [owner, repo] = repoInput.split('/');
    if (!owner || !repo) return;
    onCreateWall(owner.trim(), repo.trim());
  };

  return (
    <section className="share">
      <div>
        <h2>Create your project wall</h2>
        <p>Connect your GitHub, verify maintainership, and spin up a dedicated gratitude wall for your repo.</p>
        <button className="primary" onClick={onConnect}>Connect GitHub</button>
      </div>
      <div className="share-form">
        <label>
          GitHub Repo
          <input
            value={repoInput}
            onChange={(event) => setRepoInput(event.target.value)}
            placeholder="owner/repo"
          />
        </label>
        <button className="secondary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create Wall'}
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </section>
  );
}

function ProjectWall({ project, token, user }) {
  const [kudos, setKudos] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [boosting, setBoosting] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ sort: 'recent', tag: 'all', query: '' });
  const [form, setForm] = useState({ name: '', handle: '', tag: 'docs', message: '' });
  const [arrange, setArrange] = useState(false);
  const [order, setOrder] = useState([]);

  const key = `${project.owner}/${project.repo}`;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.tag && filters.tag !== 'all') params.set('tag', filters.tag);
    if (filters.query) params.set('query', filters.query.trim());
    return params.toString();
  }, [filters]);

  const loadKudos = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/projects/${key}/kudos?${queryString}`);
      if (!response.ok) throw new Error('Unable to load kudos');
      const data = await response.json();
      setKudos(data);
    } catch (err) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch(`${API_BASE}/projects/${key}/stats`);
      if (!response.ok) throw new Error('Unable to load stats');
      const data = await response.json();
      setStats(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadKudos();
  }, [queryString, key]);

  useEffect(() => {
    loadStats();
  }, [key]);

  useEffect(() => {
    const stored = localStorage.getItem(`gratitude_order_${key}`);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setOrder(parsed);
      } catch {
        setOrder([]);
      }
    } else {
      setOrder([]);
    }
  }, [key]);

  const orderedKudos = useMemo(() => {
    if (!order.length) return kudos;
    const map = new Map(kudos.map((item) => [item.id, item]));
    const ordered = order.map((id) => map.get(id)).filter(Boolean);
    const remaining = kudos.filter((item) => !order.includes(item.id));
    return [...ordered, ...remaining];
  }, [kudos, order]);

  const spotlight = useMemo(() => {
    if (!kudos.length) return null;
    const [top] = [...kudos].sort((a, b) => b.boosts - a.boosts || new Date(b.created_at) - new Date(a.created_at));
    return top;
  }, [kudos]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim() || !form.message.trim()) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/projects/${key}/kudos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.name.trim(),
          handle: form.handle.trim(),
          tag: form.tag,
          message: form.message.trim(),
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data?.error || 'Unable to send kudos.');
      }
      setForm({ name: '', handle: '', tag: 'docs', message: '' });
      await Promise.all([loadKudos(), loadStats()]);
    } catch (err) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const handleBoost = async (id) => {
    setBoosting(id);
    try {
      const response = await fetch(`${API_BASE}/projects/${key}/kudos/${id}/boost`, { method: 'POST' });
      if (!response.ok) throw new Error('Unable to boost.');
      await Promise.all([loadKudos(), loadStats()]);
    } catch (err) {
      setError(err?.message || 'Something went wrong.');
    } finally {
      setBoosting(null);
    }
  };

  const handleDrag = (event, id) => {
    if (!arrange) return;
    event.dataTransfer.setData('text/plain', String(id));
  };

  const handleDrop = (event, id) => {
    if (!arrange) return;
    event.preventDefault();
    const draggedId = Number(event.dataTransfer.getData('text/plain'));
    if (!draggedId || draggedId === id) return;
    const current = orderedKudos.map((item) => item.id);
    const fromIndex = current.indexOf(draggedId);
    const toIndex = current.indexOf(id);
    if (fromIndex === -1 || toIndex === -1) return;
    const next = [...current];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, draggedId);
    setOrder(next);
    localStorage.setItem(`gratitude_order_${key}`, JSON.stringify(next));
  };

  return (
    <div className="project">
      <header className="project-hero">
        <div>
          <p className="project-label">Project Wall</p>
          <h1>{project.owner}/{project.repo}</h1>
          <p className="project-sub">Maintainer‑verified gratitude for every meaningful contribution.</p>
        </div>
        <div className="project-actions">
          {user ? (
            <span className="user-chip">
              <img src={user.avatar_url} alt={user.login} />
              <span>@{user.login}</span>
            </span>
          ) : (
            <span className="badge">Viewer</span>
          )}
          <button className="ghost" onClick={() => setArrange((prev) => !prev)}>
            {arrange ? 'Done Arranging' : 'Arrange Wall'}
          </button>
        </div>
      </header>

      <section className="stats">
        <div className="stat-card">
          <div className="stat-label">Kudos Given</div>
          <div className="stat-value">{stats?.totalKudos ?? '—'}</div>
          <div className="stat-meta">This week: {stats?.weekCount ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Contributors Celebrated</div>
          <div className="stat-value">{stats?.totalContributors ?? '—'}</div>
          <div className="stat-meta">Maintainers only</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Top Impact Tag</div>
          <div className="stat-value">#{stats?.topTag ?? '—'}</div>
          <div className="stat-meta">Community theme</div>
        </div>
      </section>

      <section className="share">
        <div>
          <h2>Send a shoutout</h2>
          <p>Only maintainers can post. That keeps every note authentic.</p>
        </div>
        <form className="share-form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>
              Contributor Name
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="e.g. Priya Singh"
                required
                disabled={!token}
              />
            </label>
            <label>
              Handle (optional)
              <input
                value={form.handle}
                onChange={(event) => setForm((prev) => ({ ...prev, handle: event.target.value }))}
                placeholder="@priya"
                disabled={!token}
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Impact Tag
              <select
                value={form.tag}
                onChange={(event) => setForm((prev) => ({ ...prev, tag: event.target.value }))}
                disabled={!token}
              >
                {TAGS.map((tag) => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Message
            <textarea
              rows="4"
              value={form.message}
              onChange={(event) => setForm((prev) => ({ ...prev, message: event.target.value }))}
              placeholder="Tell them exactly what you appreciated…"
              required
              disabled={!token}
            />
          </label>
          <button className="primary" type="submit" disabled={saving || !token}>
            {saving ? 'Sending…' : token ? 'Send Kudos' : 'Login to Post'}
          </button>
        </form>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="wall">
        <div className="wall-header">
          <div>
            <h2>Gratitude Wall</h2>
            <p>Drag to arrange when in arrange mode.</p>
          </div>
          <div className="wall-controls">
            <input
              placeholder="Search by name or message"
              value={filters.query}
              onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
            />
            <select
              value={filters.tag}
              onChange={(event) => setFilters((prev) => ({ ...prev, tag: event.target.value }))}
            >
              <option value="all">All tags</option>
              {TAGS.map((tag) => (
                <option key={tag} value={tag}>
                  #{tag}
                </option>
              ))}
            </select>
            <select
              value={filters.sort}
              onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value }))}
            >
              <option value="recent">Most recent</option>
              <option value="top">Most cheered</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="empty">Loading gratitude…</div>
        ) : orderedKudos.length === 0 ? (
          <div className="empty">No kudos yet. Maintainers can add the first.</div>
        ) : (
          <div className={`card-grid ${arrange ? 'arrange' : ''}`}>
            {orderedKudos.map((entry) => (
              <article
                key={entry.id}
                className="kudos-card"
                draggable={arrange}
                onDragStart={(event) => handleDrag(event, entry.id)}
                onDragOver={(event) => arrange && event.preventDefault()}
                onDrop={(event) => handleDrop(event, entry.id)}
              >
                <div className="card-top">
                  <div>
                    <h3>{entry.name}</h3>
                    <p className="card-handle">{entry.handle || 'Contributor'}</p>
                  </div>
                  <span className="card-tag">#{entry.tag}</span>
                </div>
                <p className="card-message">“{entry.message}”</p>
                <div className="card-meta">
                  <span>{formatDate(entry.created_at)}</span>
                  <span>{spotlight?.id === entry.id ? 'Spotlight' : ''}</span>
                </div>
                <button
                  className="secondary"
                  onClick={() => handleBoost(entry.id)}
                  disabled={boosting === entry.id}
                >
                  {boosting === entry.id ? 'Cheering…' : `Cheer (${entry.boosts})`}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const { path, go } = useRoute();
  const { token, setToken, user, logout } = useAuth();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const project = parseProject(path);

  const handleConnect = () => {
    window.location.href = `${API_BASE}/auth/github`;
  };

  const handleCreateWall = async (owner, repo) => {
    if (!token) {
      setError('Please connect GitHub first.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ owner, repo }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Unable to create wall.');
      go(`/p/${data.owner}/${data.repo}`);
    } catch (err) {
      setError(err?.message || 'Unable to create wall.');
    } finally {
      setCreating(false);
    }
  };

  if (path.startsWith('/auth/callback')) {
    return <AuthCallback onToken={setToken} />;
  }

  return (
    <div className="page">
      {!project && (
        <>
          <Hero onConnect={handleConnect} user={user} />
          <Landing onConnect={handleConnect} onCreateWall={handleCreateWall} creating={creating} error={error} />
        </>
      )}
      {project && (
        <ProjectWall project={project} token={token} user={user} />
      )}
      <footer className="footer">
        <div>Project‑scoped gratitude walls for open‑source maintainers.</div>
        <div>
          {user ? (
            <button className="ghost" onClick={logout}>Log out</button>
          ) : (
            <span>Connect to post kudos.</span>
          )}
        </div>
      </footer>
    </div>
  );
}

export default App;
