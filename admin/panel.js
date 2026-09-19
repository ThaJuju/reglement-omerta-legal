/* ============================================================
   Panel staff — Règlement Légal
   ============================================================ */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const TYPES = {
  rule:    '• Règle',
  sub:     '◦ Sous-point',
  subhead: 'Intitulé',
  note:    'Encadré info',
  warn:    'Encadré alerte',
};

const SITE_FIELDS = [
  ['docTitle',         'Titre de l’onglet',            'input'],
  ['version',          'Version affichée',             'input'],
  ['brandMark',        'Initiale du logo',             'input'],
  ['brandName',        'Nom en en-tête',               'input'],
  ['brandSub',         'Sous-titre de l’en-tête',      'input'],
  ['discordUrl',       'Lien Discord',                 'input'],
  ['heroBadge',        'Pastille d’accueil',           'input'],
  ['heroTitle',        'Titre d’accueil',              'input'],
  ['heroTitleAccent',  'Titre — partie colorée',       'input'],
  ['tocTitle',         'Intitulé du sommaire',         'input'],
  ['searchPlaceholder','Texte de la barre de recherche','input'],
  ['footer',           'Pied de page',                 'input'],
  ['heroDesc',         'Description d’accueil',        'textarea'],
  ['metaDesc',         'Description pour les moteurs', 'textarea'],
];

const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ---------- état ---------- */
const state = { rev: 0, site: {}, sections: [], current: 0, dirty: false, filter: '' };

let toastTimer;
function toast(msg, ok = true) {
  const el = $('#toast');
  el.textContent = msg;
  el.style.borderColor = ok ? 'var(--ok)' : 'var(--danger)';
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
}

async function apiCall(url, opts = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw Object.assign(new Error(data.error || `Erreur ${res.status}`), { status: res.status, data });
  return data;
}

function setDirty(v) {
  state.dirty = v;
  $('#dirtyChip').hidden = !v;
  $('#saveBtn').disabled = !v;
}

/* ============================================================
   CONNEXION
   ============================================================ */
function showLogin(msg) {
  $('#app').hidden = true;
  $('#loginScreen').hidden = false;
  const err = $('#loginErr');
  err.hidden = !msg;
  if (msg) err.textContent = msg;
  $('#loginForm').username?.focus();
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('#loginBtn');
  btn.disabled = true;
  btn.textContent = 'Connexion…';
  try {
    const f = e.target;
    await apiCall('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: f.username.value, password: f.password.value }),
    });
    f.password.value = '';
    $('#loginErr').hidden = true;
    await boot();
  } catch (err) {
    showLogin(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Se connecter';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  if (state.dirty && !confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')) return;
  await apiCall('/api/logout', { method: 'POST' }).catch(() => {});
  location.reload();
});

/* ============================================================
   SOMMAIRE
   ============================================================ */
function renderSide() {
  const list = $('#sideList');
  const q = norm(state.filter.trim());

  list.innerHTML = state.sections.map((s, i) => {
    if (q && !norm(s.titre).includes(q) && !s.items.some(it => norm(it.x).includes(q))) return '';
    const n = s.items.filter(it => it.t !== 'subhead').length;
    return `<div class="side-item${i === state.current ? ' active' : ''}" data-i="${i}">
      <span class="si-grip">⠿</span>
      <span class="si-emoji">${s.emoji || '📌'}</span>
      <span class="si-label"></span>
      <span class="si-count">${n}</span>
    </div>`;
  }).join('') || '<p class="side-hint" style="padding:10px 4px">Aucune section ne correspond.</p>';

  // titres en textContent : jamais d'injection HTML
  $$('.side-item', list).forEach(el => {
    el.querySelector('.si-label').textContent = state.sections[+el.dataset.i].titre;
  });
  $('#sideCount').textContent = state.sections.length;
}

/* drag & drop du sommaire */
let dragFrom = null;
function wireDnd(container, itemSel, onDrop) {
  // le glisser-déposer ne s'arme que depuis la poignée : ailleurs, le texte
  // reste sélectionnable normalement
  const arm = e => {
    const el = e.target.closest(itemSel);
    if (el) el.draggable = !!e.target.closest('.si-grip, .it-grip');
  };
  container.addEventListener('mousedown', arm);
  container.addEventListener('touchstart', arm, { passive: true });

  container.addEventListener('dragstart', e => {
    const el = e.target.closest(itemSel);
    if (!el) return;
    dragFrom = +el.dataset.i;
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragFrom));
  });
  container.addEventListener('dragend', () => {
    dragFrom = null;
    $$(itemSel, container).forEach(el => {
      el.classList.remove('dragging', 'drop-before', 'drop-after');
      el.draggable = false;
    });
  });
  container.addEventListener('dragover', e => {
    const el = e.target.closest(itemSel);
    if (!el || dragFrom === null) return;
    e.preventDefault();
    const after = e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
    $$(itemSel, container).forEach(x => x.classList.remove('drop-before', 'drop-after'));
    el.classList.add(after ? 'drop-after' : 'drop-before');
  });
  container.addEventListener('drop', e => {
    const el = e.target.closest(itemSel);
    if (!el || dragFrom === null) return;
    e.preventDefault();
    const to    = +el.dataset.i;
    const after = e.clientY > el.getBoundingClientRect().top + el.offsetHeight / 2;
    onDrop(dragFrom, after ? to + 1 : to);
  });
}

const move = (arr, from, to) => {
  const [x] = arr.splice(from, 1);
  arr.splice(from < to ? to - 1 : to, 0, x);
  return from < to ? to - 1 : to;
};

wireDnd($('#sideList'), '.side-item', (from, to) => {
  if (from === to || from === to - 1) return;
  const at = move(state.sections, from, to);
  state.current = at;
  setDirty(true);
  renderSide();
  renderEditor();
});

$('#sideList').addEventListener('click', e => {
  const el = e.target.closest('.side-item');
  if (!el) return;
  state.current = +el.dataset.i;
  renderSide();
  renderEditor();
});

$('#sideSearch').addEventListener('input', e => { state.filter = e.target.value; renderSide(); });

$('#addSectionBtn').addEventListener('click', () => {
  state.sections.push({ emoji: '📌', titre: 'Nouvelle section', items: [{ t: 'rule', x: '' }] });
  state.current = state.sections.length - 1;
  state.filter = '';
  $('#sideSearch').value = '';
  setDirty(true);
  renderSide();
  renderEditor();
  $('#edTitle').select();
});

/* ============================================================
   ÉDITEUR DE SECTION
   ============================================================ */
function renderEditor() {
  const s = state.sections[state.current];
  $('#editorEmpty').hidden = !!s;
  $('#editorBody').hidden  = !s;
  if (!s) return;

  $('#edEmoji').value = s.emoji || '';
  $('#edTitle').value = s.titre;
  $('#edAnchor').textContent = `Lien direct : /#${slug(s.titre)}`;

  const box = $('#items');
  if (!s.items.length) {
    box.innerHTML = '<p class="side-hint" style="padding:14px 2px">Section vide — ajoute une première règle ci-dessous.</p>';
    return;
  }
  box.innerHTML = s.items.map((it, i) => `
    <div class="item" data-i="${i}" data-t="${it.t}">
      <span class="it-grip" title="Déplacer">⠿</span>
      <select class="it-type">
        ${Object.entries(TYPES).map(([v, l]) =>
          `<option value="${v}"${v === it.t ? ' selected' : ''}>${l}</option>`).join('')}
      </select>
      <textarea class="it-text" rows="1" placeholder="Texte… (**gras** possible)"></textarea>
      <button class="it-add" title="Insérer une règle en dessous (Ctrl+Entrée)">+</button>
      <button class="it-del" title="Supprimer la ligne">×</button>
    </div>`).join('');

  $$('.item', box).forEach(el => {
    const ta = el.querySelector('.it-text');
    ta.value = s.items[+el.dataset.i].x;
    autosize(ta);
  });
}

/* insère une ligne ; index = null -> à la fin */
function addItem(type, index = null) {
  const items = state.sections[state.current].items;
  const at = index === null ? items.length : index + 1;
  items.splice(at, 0, { t: type, x: '' });
  setDirty(true);
  renderEditor();
  renderSide();
  const el = $$('.item')[at]?.querySelector('.it-text');
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 360) + 'px';
}

$('#edEmoji').addEventListener('input', e => {
  state.sections[state.current].emoji = e.target.value;
  setDirty(true);
  renderSide();
});
$('#edTitle').addEventListener('input', e => {
  state.sections[state.current].titre = e.target.value;
  $('#edAnchor').textContent = `Lien direct : /#${slug(e.target.value)}`;
  setDirty(true);
  renderSide();
});

$('#items').addEventListener('input', e => {
  const el = e.target.closest('.item');
  if (!el) return;
  const it = state.sections[state.current].items[+el.dataset.i];
  if (e.target.classList.contains('it-text')) { it.x = e.target.value; autosize(e.target); }
  setDirty(true);
});

$('#items').addEventListener('change', e => {
  const el = e.target.closest('.item');
  if (!el || !e.target.classList.contains('it-type')) return;
  state.sections[state.current].items[+el.dataset.i].t = e.target.value;
  el.dataset.t = e.target.value;
  setDirty(true);
});

$('#items').addEventListener('click', e => {
  const el = e.target.closest('.item');
  if (!el) return;

  if (e.target.classList.contains('it-add')) return addItem('rule', +el.dataset.i);

  if (e.target.classList.contains('it-del')) {
    state.sections[state.current].items.splice(+el.dataset.i, 1);
    setDirty(true);
    renderEditor();
    renderSide();
  }
});

// Ctrl+Entrée dans un champ : nouvelle règle juste en dessous
$('#items').addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return;
  const el = e.target.closest('.item');
  if (!el) return;
  e.preventDefault();
  addItem('rule', +el.dataset.i);
});

wireDnd($('#items'), '.item', (from, to) => {
  if (from === to || from === to - 1) return;
  move(state.sections[state.current].items, from, to);
  setDirty(true);
  renderEditor();
});

$$('[data-add]').forEach(btn =>
  btn.addEventListener('click', () => addItem(btn.dataset.add)));

$('#dupSectionBtn').addEventListener('click', () => {
  const s = state.sections[state.current];
  const copy = JSON.parse(JSON.stringify(s));
  copy.titre = s.titre + ' (copie)';
  state.sections.splice(state.current + 1, 0, copy);
  state.current++;
  setDirty(true);
  renderSide();
  renderEditor();
});

$('#delSectionBtn').addEventListener('click', () => {
  const s = state.sections[state.current];
  if (!confirm(`Supprimer la section « ${s.titre} » et ses ${s.items.length} ligne(s) ?`)) return;
  state.sections.splice(state.current, 1);
  state.current = Math.max(0, state.current - 1);
  setDirty(true);
  renderSide();
  renderEditor();
});

/* ============================================================
   TEXTES DU SITE
   ============================================================ */
function renderSite() {
  $('#siteFields').innerHTML = SITE_FIELDS.map(([key, label, kind]) => `
    <label class="field${kind === 'textarea' ? ' wide' : ''}">
      <span></span>
      ${kind === 'textarea' ? `<textarea data-site="${key}" rows="3"></textarea>`
                            : `<input data-site="${key}">`}
    </label>`).join('');

  SITE_FIELDS.forEach(([key, label]) => {
    const input = $(`[data-site="${key}"]`);
    input.previousElementSibling.textContent = label;
    input.value = state.site[key] ?? '';
  });
}

$('#siteFields').addEventListener('input', e => {
  const key = e.target.dataset.site;
  if (!key) return;
  state.site[key] = e.target.value;
  setDirty(true);
});

/* ============================================================
   ONGLETS
   ============================================================ */
$$('.atab').forEach(tab => tab.addEventListener('click', () => {
  $$('.atab').forEach(t => t.classList.toggle('active', t === tab));
  const site = tab.dataset.view === 'site';
  $('#viewSite').hidden = !site;
  $('#viewReglement').hidden = site;
}));

/* ============================================================
   ENREGISTREMENT
   ============================================================ */
async function save() {
  const btn = $('#saveBtn');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  try {
    const r = await apiCall('/api/content', {
      method: 'PUT',
      body: JSON.stringify({ rev: state.rev, site: state.site, sections: state.sections }),
    });
    state.rev = r.rev;
    $('#revChip').textContent = `rév. ${r.rev}`;
    setDirty(false);
    toast('Règlement enregistré et publié.');
  } catch (err) {
    if (err.status === 401) return showLogin('Session expirée, reconnecte-toi.');
    toast(err.message, false);
    setDirty(true);
  } finally {
    btn.textContent = 'Enregistrer';
  }
}

$('#saveBtn').addEventListener('click', save);

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (state.dirty) save();
  }
  if (e.key === 'Escape' && !$('#overlay').hidden) closeModal();
});

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ============================================================
   MODALES
   ============================================================ */
const closeModal = () => { $('#overlay').hidden = true; $('#modal').innerHTML = ''; };
$('#overlay').addEventListener('click', e => { if (e.target === $('#overlay')) closeModal(); });

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#overlay').hidden = false;
}

$('#pwdBtn').addEventListener('click', () => {
  openModal(`
    <h3>Changer mon mot de passe</h3>
    <p class="sub">8 caractères minimum.</p>
    <div class="err" id="pwdErr" hidden></div>
    <label class="field"><span>Mot de passe actuel</span><input type="password" id="pwdCur" autocomplete="current-password"></label>
    <label class="field"><span>Nouveau mot de passe</span><input type="password" id="pwdNew" autocomplete="new-password"></label>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" id="pwdCancel">Annuler</button>
      <button class="btn btn-primary btn-sm" id="pwdOk">Changer</button>
    </div>`);

  $('#pwdCancel').onclick = closeModal;
  $('#pwdOk').onclick = async () => {
    const err = $('#pwdErr');
    try {
      await apiCall('/api/password', {
        method: 'POST',
        body: JSON.stringify({ current: $('#pwdCur').value, next: $('#pwdNew').value }),
      });
      closeModal();
      toast('Mot de passe modifié.');
    } catch (e) {
      err.hidden = false;
      err.textContent = e.message;
    }
  };
});

$('#backupsBtn').addEventListener('click', async () => {
  openModal('<h3>Historique</h3><p class="sub">Chargement…</p>');
  try {
    const { backups } = await apiCall('/api/backups');
    const rows = backups.map(f => {
      const iso = f.replace('content-', '').replace('.json', '');
      const d = new Date(iso.replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z').replace(/(\d{4}-\d{2}-\d{2})-/, '$1T'));
      const label = isNaN(d) ? iso : d.toLocaleString('fr-FR');
      return `<div class="bk"><time>${label}</time>
        <button class="btn btn-ghost btn-sm" data-restore="${f}">Restaurer</button></div>`;
    }).join('') || '<p class="sub">Aucune sauvegarde pour l’instant.</p>';

    openModal(`
      <h3>Historique</h3>
      <p class="sub">Une sauvegarde est créée avant chaque enregistrement (30 dernières conservées).</p>
      <div class="bk-list">${rows}</div>
      <div class="modal-actions"><button class="btn btn-ghost btn-sm" id="bkClose">Fermer</button></div>`);

    $('#bkClose').onclick = closeModal;
    $$('[data-restore]').forEach(b => b.onclick = async () => {
      if (!confirm('Restaurer cette version ? La version actuelle sera sauvegardée avant.')) return;
      try {
        await apiCall('/api/backups/' + encodeURIComponent(b.dataset.restore), { method: 'POST' });
        closeModal();
        toast('Version restaurée.');
        await load();
      } catch (e) { toast(e.message, false); }
    });
  } catch (e) {
    openModal(`<h3>Historique</h3><div class="err">${e.message}</div>
      <div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="location.reload()">Fermer</button></div>`);
  }
});

/* ============================================================
   DÉMARRAGE
   ============================================================ */
async function load() {
  const c = await apiCall('/api/content');
  state.rev      = c.rev;
  state.site     = { ...c.site };
  state.sections = JSON.parse(JSON.stringify(c.sections));
  state.current  = Math.min(state.current, state.sections.length - 1);
  $('#revChip').textContent = `rév. ${c.rev}`;
  setDirty(false);
  renderSide();
  renderEditor();
  renderSite();
}

async function boot() {
  try {
    await apiCall('/api/me');
  } catch {
    showLogin();
    return;
  }
  $('#loginScreen').hidden = true;
  $('#app').hidden = false;
  await load();
}

boot();

})();
