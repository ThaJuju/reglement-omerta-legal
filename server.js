/* ============================================================
   Omerta — Règlement Légal
   Serveur statique + API du panel staff (zéro dépendance)
   ============================================================ */
'use strict';
const http   = require('http');
const fs     = require('fs');
const fsp    = require('fs/promises');
const path   = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3007;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CONTENT_FILE = path.join(DATA, 'content.json');
const USERS_FILE   = path.join(DATA, 'users.json');
const SECRET_FILE  = path.join(DATA, 'secret.key');
const BACKUP_DIR   = path.join(DATA, 'backups');
const MAX_BACKUPS  = 30;
const SESSION_MS   = 12 * 60 * 60 * 1000;

/* chemins jamais servis en statique */
const BLOCKED = [/^[\\/]data([\\/]|$)/i, /^[\\/]server\.js$/i, /^[\\/]ecosystem\.config\.js$/i];

/* ---------------------------------------------------------- utils */
const j = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

/* ---------------------------------------------------------- secret & sessions */
function loadSecret() {
  try { return fs.readFileSync(SECRET_FILE); }
  catch {
    const s = crypto.randomBytes(48);
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(SECRET_FILE, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();

const b64u  = b => Buffer.from(b).toString('base64url');
const sign  = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

function makeToken(username) {
  const payload = b64u(JSON.stringify({ u: username, e: Date.now() + SESSION_MS }));
  return `${payload}.${sign(payload)}`;
}

function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  const expected = sign(payload);
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return p.e > Date.now() ? p : null;
  } catch { return null; }
}

const parseCookies = h => Object.fromEntries(
  (h || '').split(';').map(c => {
    const i = c.indexOf('=');
    return i === -1 ? null : [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
  }).filter(Boolean)
);

const auth = req => readToken(parseCookies(req.headers.cookie).sess);

/* ---------------------------------------------------------- comptes */
const hashPwd = (pwd, salt) => crypto.scryptSync(pwd, salt, 64).toString('hex');

async function loadUsers() {
  try { return JSON.parse(await fsp.readFile(USERS_FILE, 'utf8')); }
  catch { return []; }
}
const saveUsers = users =>
  fsp.writeFile(USERS_FILE, JSON.stringify(users, null, 1), { mode: 0o600 });

function checkPwd(user, pwd) {
  const candidate = Buffer.from(hashPwd(pwd, user.salt), 'hex');
  const stored    = Buffer.from(user.hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

/* anti bruteforce simple, en mémoire */
const attempts = new Map();
function throttled(ip) {
  const a = attempts.get(ip);
  if (!a) return false;
  if (Date.now() - a.last > 10 * 60 * 1000) { attempts.delete(ip); return false; }
  return a.n >= 8;
}
function noteFail(ip) {
  const a = attempts.get(ip) || { n: 0 };
  a.n++; a.last = Date.now();
  attempts.set(ip, a);
}

/* ---------------------------------------------------------- contenu */
async function loadContent() {
  return JSON.parse(await fsp.readFile(CONTENT_FILE, 'utf8'));
}

async function backup(current) {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
  const name = `content-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await fsp.writeFile(path.join(BACKUP_DIR, name), JSON.stringify(current, null, 1));
  const files = (await fsp.readdir(BACKUP_DIR)).filter(f => f.startsWith('content-')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - MAX_BACKUPS))) {
    await fsp.unlink(path.join(BACKUP_DIR, old)).catch(() => {});
  }
}

/* ---------------------------------------------------------- validation */
class Invalid extends Error {}   // erreur de saisie -> 400, pas de trace serveur

const TYPES_ITEM = new Set(['rule', 'sub', 'subhead', 'note', 'warn']);
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';

function sanitize(body, previous) {
  if (!body || typeof body !== 'object') throw new Invalid('Corps de requête invalide');
  if (!Array.isArray(body.sections)) throw new Invalid('`sections` doit être un tableau');
  if (body.sections.length > 200) throw new Invalid('Trop de sections (max 200)');

  const site = {};
  for (const k of Object.keys(previous.site)) site[k] = str(body.site?.[k] ?? previous.site[k], 400);

  const sections = body.sections.map((s, i) => {
    const titre = str(s?.titre, 160).trim();
    if (!titre) throw new Invalid(`La section n°${i + 1} n'a pas de titre`);
    if (!Array.isArray(s.items)) throw new Invalid(`La section « ${titre} » n'a pas de contenu`);
    if (s.items.length > 500) throw new Invalid(`La section « ${titre} » dépasse 500 lignes`);
    return {
      emoji: str(s.emoji, 8),
      titre,
      items: s.items.map(it => ({
        t: TYPES_ITEM.has(it?.t) ? it.t : 'rule',
        x: str(it?.x, 4000).trim(),
      })).filter(it => it.x),
    };
  });

  return { site, sections };
}

/* ---------------------------------------------------------- API */
async function api(req, res, url) {
  const route = url.pathname.slice(5); // retire "/api/"

  /* --- public --- */
  if (route === 'content' && req.method === 'GET') {
    const c = await loadContent();
    return j(res, 200, { rev: c.rev, updatedAt: c.updatedAt, site: c.site, sections: c.sections });
  }

  /* --- session --- */
  if (route === 'login' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '?';
    if (throttled(ip)) return j(res, 429, { error: 'Trop de tentatives. Réessaie dans 10 minutes.' });

    const { username, password } = await readBody(req, 8 * 1024);
    const users = await loadUsers();
    const user  = users.find(u => u.username === String(username || '').toLowerCase().trim());

    if (!user || !checkPwd(user, String(password || ''))) {
      noteFail(ip);
      return j(res, 401, { error: 'Identifiants incorrects.' });
    }
    attempts.delete(ip);
    res.setHeader('Set-Cookie',
      `sess=${makeToken(user.username)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
    return j(res, 200, { username: user.username });
  }

  if (route === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', 'sess=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return j(res, 200, { ok: true });
  }

  if (route === 'me' && req.method === 'GET') {
    const s = auth(req);
    return s ? j(res, 200, { username: s.u }) : j(res, 401, { error: 'Non connecté' });
  }

  /* --- protégé --- */
  const session = auth(req);
  if (!session) return j(res, 401, { error: 'Session expirée, reconnecte-toi.' });

  if (route === 'content' && req.method === 'PUT') {
    const body    = await readBody(req);
    const current = await loadContent();

    if (body.rev != null && Number(body.rev) !== current.rev) {
      return j(res, 409, {
        error: `Quelqu'un a enregistré entre-temps (révision ${current.rev}). Recharge le panel pour repartir de la dernière version.`,
        rev: current.rev,
      });
    }

    const clean = sanitize(body, current);
    const next  = {
      rev: current.rev + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: session.u,
      site: clean.site,
      sections: clean.sections,
    };

    await backup(current);
    const tmp = CONTENT_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(next, null, 1));
    await fsp.rename(tmp, CONTENT_FILE);

    return j(res, 200, { rev: next.rev, updatedAt: next.updatedAt, updatedBy: next.updatedBy });
  }

  if (route === 'password' && req.method === 'POST') {
    const { current, next } = await readBody(req, 8 * 1024);
    if (!next || String(next).length < 8) {
      return j(res, 400, { error: 'Le nouveau mot de passe doit faire au moins 8 caractères.' });
    }
    const users = await loadUsers();
    const user  = users.find(u => u.username === session.u);
    if (!user || !checkPwd(user, String(current || ''))) {
      return j(res, 401, { error: 'Mot de passe actuel incorrect.' });
    }
    user.salt = crypto.randomBytes(16).toString('hex');
    user.hash = hashPwd(String(next), user.salt);
    await saveUsers(users);
    return j(res, 200, { ok: true });
  }

  if (route === 'backups' && req.method === 'GET') {
    const files = await fsp.readdir(BACKUP_DIR).catch(() => []);
    return j(res, 200, {
      backups: files.filter(f => f.startsWith('content-')).sort().reverse().slice(0, MAX_BACKUPS),
    });
  }

  if (route.startsWith('backups/') && req.method === 'POST') {
    const name = path.basename(route.slice(8));
    if (!/^content-[\w.-]+\.json$/.test(name)) return j(res, 400, { error: 'Sauvegarde inconnue' });

    const snap    = JSON.parse(await fsp.readFile(path.join(BACKUP_DIR, name), 'utf8'));
    const current = await loadContent();
    await backup(current);

    const next = {
      rev: current.rev + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: session.u,
      site: snap.site,
      sections: snap.sections,
    };
    const tmp = CONTENT_FILE + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(next, null, 1));
    await fsp.rename(tmp, CONTENT_FILE);
    return j(res, 200, { rev: next.rev });
  }

  return j(res, 404, { error: 'Route inconnue' });
}

/* ---------------------------------------------------------- statique */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css' : 'text/css; charset=utf-8',
  '.js'  : 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg' : 'image/svg+xml',
  '.png' : 'image/png',
  '.jpg' : 'image/jpeg',
  '.webp': 'image/webp',
  '.ico' : 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md'  : 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  if (pathname.endsWith('/')) pathname += 'index.html';
  const rel = path.normalize(pathname);
  if (BLOCKED.some(re => re.test(rel))) { res.writeHead(403).end('Forbidden'); return; }

  const file = path.join(ROOT, rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('Forbidden'); return; }

  fs.stat(file, (err, st) => {
    // /admin -> /admin/  (sinon les chemins relatifs de la page cassent)
    if (!err && st.isDirectory()) {
      res.writeHead(301, { Location: pathname + '/', 'Cache-Control': 'no-store' }).end();
      return;
    }
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
         .end('<h1>404</h1><p><a href="/">Retour au règlement</a></p>');
      return;
    }
    const ext  = path.extname(file).toLowerCase();
    const etag = `W/"${st.size}-${st.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }

    res.writeHead(200, {
      'Content-Type'  : MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'ETag'          : etag,
      'Last-Modified' : st.mtime.toUTCString(),
      'Cache-Control' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------------------------------------------------- serveur */
http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); }
  catch { return void res.writeHead(400).end('Bad Request'); }

  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    try {
      await api(req, res, url);
    } catch (e) {
      if (res.headersSent) return;
      if (e instanceof Invalid) return j(res, 400, { error: e.message });
      if (['bad-json', 'payload-too-large'].includes(e.message)) return j(res, 400, { error: 'Requête invalide.' });
      console.error('[api]', e);
      j(res, 500, { error: 'Erreur serveur' });
    }
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return void res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
  }
  serveStatic(req, res, pathname);
}).listen(PORT, HOST, () => {
  console.log(`[omerta-legal] http://${HOST}:${PORT}  ·  panel : /admin/`);
});
