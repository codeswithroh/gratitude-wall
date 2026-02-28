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

const THEME_OPTIONS = [
  { id: 'warm', label: 'Warm' },
  { id: 'midnight', label: 'Midnight' },
];

const ACCENTS = ['#ff6a3d', '#2b7a78', '#6f5cff', '#f4b400', '#ef476f'];

const LAYOUTS = [
  { id: 'masonry', label: 'Masonry' },
  { id: 'compact', label: 'Compact' },
];

const BACKGROUNDS = [
  { id: 'sunset', label: 'Sunset' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'paper', label: 'Paper' },
  { id: 'neon', label: 'Neon' },
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

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!user) return null;

  return (
    <div className="user-menu">
      <button className="user-chip" onClick={() => setOpen((prev) => !prev)}>
        <img src={user.avatar_url} alt={user.login} />
        <span>@{user.login}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="user-modal" onClick={() => setOpen(false)}>
          <div className="user-modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="user-modal-header">
              <img src={user.avatar_url} alt={user.login} />
              <div>
                <div className="user-modal-title">Signed in as</div>
                <div className="user-modal-login">@{user.login}</div>
              </div>
            </div>
            <button className="primary" onClick={onLogout}>Log out</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Hero({ onConnect, user, onLogout }) {
  return (
    <header className="hero">
      <div className="hero-top">
        <span className="pill">Maintainer Verified</span>
        <div className="hero-actions">
          {user ? (
            <UserMenu user={user} onLogout={onLogout} />
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

function AuthCallback({ onToken, onConnect }) {
  const [status, setStatus] = useState({ state: 'working', message: 'Securing your session…' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || params.get('access_token');
    const error = params.get('error');
    if (token) {
      localStorage.setItem('gratitude_token', token);
      onToken(token);
      window.history.replaceState({}, '', '/');
      return;
    }
    if (error) {
      setStatus({ state: 'error', message: decodeURIComponent(error) });
      return;
    }

    const timeout = setTimeout(() => {
      setStatus({
        state: 'error',
        message: 'Still waiting on GitHub. This usually means the backend callback failed or was blocked.',
      });
    }, 6000);

    return () => clearTimeout(timeout);
  }, [onToken]);

  return (
    <div className="loading-shell">
      <div className="loading-card">
        <div className="loading-orbit">
          <div className="orbit-ring"></div>
          <div className="orbit-dot"></div>
          <div className="orbit-dot two"></div>
        </div>
        <h2>Connecting your GitHub…</h2>
        <p>{status.message}</p>
        {status.state === 'working' ? (
          <div className="loading-steps">
            <span className="step">Verifying OAuth</span>
            <span className="step">Confirming maintainer access</span>
            <span className="step">Preparing your wall</span>
          </div>
        ) : (
          <div className="loading-actions">
            <button className="primary" onClick={onConnect}>Try again</button>
            <a className="ghost" href="/">Back to home</a>
          </div>
        )}
      </div>
      <div className="loading-grid">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="loading-tile">
            <div className="tile-line"></div>
            <div className="tile-line short"></div>
            <div className="tile-chip"></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RepoPicker({ token, onConnect, onCreateWall, creating, error, user, onLogout }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  const loadRepos = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/github/repos`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Unable to load repos');
      const data = await response.json();
      setRepos(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRepos();
  }, [token]);

  const filtered = repos.filter((repo) => repo.full_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="repo-stage">
      <div className="repo-stage-header">
        <div className="stepper">
          <div className="step active">1. Connect to Git provider</div>
          <div className={`step ${token ? 'active' : ''}`}>2. Select repository</div>
          <div className={`step ${selected ? 'active' : ''}`}>3. Configure wall</div>
        </div>
        <div className="repo-stage-title">Let’s deploy your gratitude wall…</div>
        <div className="repo-stage-actions">
          {user ? (
            <UserMenu user={user} onLogout={onLogout} />
          ) : (
            <button className="primary" onClick={onConnect}>Connect GitHub</button>
          )}
        </div>
      </div>

      <div className="repo-stage-grid">
        <div className="repo-panel">
          <div className="repo-toolbar">
            <div className="repo-search">
              <span>🔎</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search your repos"
                disabled={!token}
              />
            </div>
            <button className="ghost" onClick={loadRepos} disabled={!token || loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {loading && <div className="repo-empty">Loading repos…</div>}
          {!loading && token && (
            <div className="repo-list-dark">
              {filtered.slice(0, 10).map((repo) => (
                <button
                  key={repo.full_name}
                  className={`repo-row ${selected?.full_name === repo.full_name ? 'active' : ''}`}
                  onClick={() => setSelected(repo)}
                  type="button"
                >
                  <div className="repo-row-main">
                    <div className="repo-row-title">{repo.full_name}</div>
                    <div className="repo-row-sub">{repo.language || '—'} • {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : 'Updated recently'}</div>
                  </div>
                  <span className={`repo-badge ${repo.private ? 'private' : ''}`}>{repo.private ? 'Private' : 'Public'}</span>
                </button>
              ))}
            </div>
          )}
          {!token && <div className="repo-empty">Connect GitHub to see your repositories.</div>}
          {error && <div className="error">{error}</div>}
        </div>

        <div className="repo-preview">
          <div className="preview-card">
            <div className="preview-hero"></div>
            <div className="preview-lines">
              <div className="preview-line"></div>
              <div className="preview-line"></div>
              <div className="preview-line short"></div>
            </div>
          </div>
          <button
            className="primary"
            onClick={() => selected && onCreateWall(selected.owner, selected.repo)}
            disabled={creating || !selected}
          >
            {creating ? 'Creating…' : 'Create Wall'}
          </button>
        </div>
      </div>
    </section>
  );
}

function ProjectWall({ project, token, user, onLogout }) {
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
  const [settings, setSettings] = useState({ theme: 'warm', accent: '#ff6a3d', layout: 'masonry', background: 'sunset' });
  const [featuredIds, setFeaturedIds] = useState([]);
  const [tab, setTab] = useState('overview');

  const key = `${project.owner}/${project.repo}`;
  const wallUrl = `${window.location.origin}/p/${project.owner}/${project.repo}`;
  const snapshotUrl = `${API_BASE}/projects/${project.owner}/${project.repo}/snapshot.svg?theme=${settings.theme}&accent=${encodeURIComponent(settings.accent)}&background=${settings.background}&layout=${settings.layout}`;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.tag && filters.tag !== 'all') params.set('tag', filters.tag);
    if (filters.query) params.set('query', filters.query.trim());
    return params.toString();
  }, [filters]);

  const loadProject = async () => {
    const response = await fetch(`${API_BASE}/projects/${project.owner}/${project.repo}`);
    if (response.ok) {
      const data = await response.json();
      if (data.settings) setSettings(data.settings);
      if (data.featured_ids) setFeaturedIds(data.featured_ids);
    }
  };

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
    loadProject();
  }, [key]);

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

  const toggleFeatured = async (id) => {
    if (!token) return;
    const isFeatured = featuredIds.includes(id);
    const url = isFeatured
      ? `${API_BASE}/projects/${key}/featured/${id}`
      : `${API_BASE}/projects/${key}/featured`;
    const method = isFeatured ? 'DELETE' : 'POST';
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: isFeatured ? undefined : JSON.stringify({ kudosId: id }),
    });
    if (response.ok) {
      const data = await response.json();
      setFeaturedIds(data.featured_ids || []);
    }
  };

  const updateSettings = async (next) => {
    setSettings(next);
    if (!token) return;
    await fetch(`${API_BASE}/projects/${key}/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(next),
    });
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

  const copyText = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={`project wall-theme-${settings.theme} wall-bg-${settings.background}`}
      style={{ '--accent': settings.accent }}
    >
      <header className="project-hero">
        <div>
          <p className="project-label">Project Wall</p>
          <h1>{project.owner}/{project.repo}</h1>
          <p className="project-sub">Maintainer‑verified gratitude for every meaningful contribution.</p>
        </div>
        <div className="project-actions">
          {user ? (
            <UserMenu user={user} onLogout={onLogout} />
          ) : (
            <span className="badge">Viewer</span>
          )}
          <button className="ghost" onClick={() => setArrange((prev) => !prev)}>
            {arrange ? 'Done Arranging' : 'Arrange Wall'}
          </button>
        </div>
      </header>

      <div className="tabs">
        <button className={`tab-btn ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
        <button className={`tab-btn ${tab === 'wall' ? 'active' : ''}`} onClick={() => setTab('wall')}>Wall</button>
        <button className={`tab-btn ${tab === 'shoutouts' ? 'active' : ''}`} onClick={() => setTab('shoutouts')}>Shoutouts</button>
      </div>

      {tab === 'overview' && (
        <>
          <section className="share-link">
            <div>
              <h3>Shareable Wall Link</h3>
              <p>Use this link to share the wall or drop the snapshot into your README.</p>
            </div>
            <div className="link-box">
              <div className="link-row">
                <span>{wallUrl}</span>
                <button className="secondary" onClick={() => copyText(wallUrl)}>Copy link</button>
              </div>
              <div className="link-row">
                <span>{`![Gratitude Wall](${snapshotUrl})`}</span>
                <button className="secondary" onClick={() => copyText(`![Gratitude Wall](${snapshotUrl})`)}>Copy README</button>
              </div>
            </div>
            <div className="snapshot-preview">
              <img src={snapshotUrl} alt="Wall snapshot" />
            </div>
          </section>

          <section className="customize">
            <div>
              <h3>Customize your wall</h3>
              <p>Pick a theme, accent, and layout that fits your community.</p>
            </div>
            <div className="customize-controls">
              <div className="custom-group">
                <div className="custom-label">Theme</div>
                <div className="custom-options">
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      className={`pill-btn ${settings.theme === opt.id ? 'active' : ''}`}
                      onClick={() => updateSettings({ ...settings, theme: opt.id })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="custom-group">
                <div className="custom-label">Accent</div>
                <div className="custom-options">
                  {ACCENTS.map((color) => (
                    <button
                      key={color}
                      className={`color-swatch ${settings.accent === color ? 'active' : ''}`}
                      style={{ background: color }}
                      onClick={() => updateSettings({ ...settings, accent: color })}
                    />
                  ))}
                </div>
              </div>
              <div className="custom-group">
                <div className="custom-label">Layout</div>
                <div className="custom-options">
                  {LAYOUTS.map((layout) => (
                    <button
                      key={layout.id}
                      className={`pill-btn ${settings.layout === layout.id ? 'active' : ''}`}
                      onClick={() => updateSettings({ ...settings, layout: layout.id })}
                    >
                      {layout.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="custom-group">
                <div className="custom-label">Background</div>
                <div className="custom-options">
                  {BACKGROUNDS.map((bg) => (
                    <button
                      key={bg.id}
                      className={`pill-btn ${settings.background === bg.id ? 'active' : ''}`}
                      onClick={() => updateSettings({ ...settings, background: bg.id })}
                    >
                      {bg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

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
        </>
      )}

      {tab === 'shoutouts' && (
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
      )}

      {tab === 'wall' && (
        <section className="wall">
          <div className="wall-header">
            <div>
              <h2>Gratitude Wall</h2>
              <p>Drag to arrange when in arrange mode. Pin highlights to feature them in the snapshot.</p>
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
            <div className={`card-grid ${arrange ? 'arrange' : ''} ${settings.layout === 'compact' ? 'compact' : ''}`}>
              {orderedKudos.map((entry) => {
                const isFeatured = featuredIds.includes(entry.id);
                return (
                  <article
                    key={entry.id}
                    className={`kudos-card ${isFeatured ? 'featured' : ''}`}
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
                    <div className="card-actions">
                      <button
                        className="secondary"
                        onClick={() => handleBoost(entry.id)}
                        disabled={boosting === entry.id}
                      >
                        {boosting === entry.id ? 'Cheering…' : `Cheer (${entry.boosts})`}
                      </button>
                      {token && (
                        <button className="ghost" onClick={() => toggleFeatured(entry.id)}>
                          {isFeatured ? 'Unpin' : 'Pin'}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
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
      const response = await fetch(`${API_BASE}/projects/from-github`, {
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
    return <AuthCallback onToken={setToken} onConnect={handleConnect} />;
  }

  return (
    <div className="page">
      {!project && (
        <>
          <Hero onConnect={handleConnect} user={user} onLogout={logout} />
          <RepoPicker
            token={token}
            onConnect={handleConnect}
            onCreateWall={handleCreateWall}
            creating={creating}
            error={error}
            user={user}
            onLogout={logout}
          />
        </>
      )}
      {project && (
        <ProjectWall project={project} token={token} user={user} onLogout={logout} />
      )}
      <footer className="footer">
        <div>Project‑scoped gratitude walls for open‑source maintainers.</div>
      </footer>
    </div>
  );
}

export default App;
