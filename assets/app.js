/* ============================================================
   Omerta — Règlement Légal · page publique
   Le contenu vient de /api/content (édité via /admin/).
   ============================================================ */
(() => {
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- utilitaires ---------- */
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// **gras** -> <strong>
const fmt = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

const slugify = s => s.toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2000);
}

/* navigator.clipboard n'existe qu'en contexte sécurisé (HTTPS ou localhost) :
   repli sur une zone de texte temporaire quand le site est servi en HTTP */
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  return ok;
}

let sections = [];

/* ---------- textes du site ---------- */
function applySite(site = {}) {
  const set = (sel, val) => { const el = $(sel); if (el && val != null && val !== '') el.textContent = val; };

  if (site.docTitle) document.title = site.docTitle;
  const meta = $('meta[name="description"]');
  if (meta && site.metaDesc) meta.content = site.metaDesc;

  set('#brandMark', site.brandMark);
  set('#brandName', site.brandName);
  set('#brandSub',  site.brandSub);
  set('#heroBadge', site.heroBadge);
  set('#heroTitle', site.heroTitle);
  set('#heroAccent', site.heroTitleAccent);
  set('#heroDesc',  site.heroDesc);
  set('#statVersion', site.version);
  set('#tocTitle',  site.tocTitle);
  set('#footerTxt', site.footer);

  if (site.searchPlaceholder) $('#searchInput').placeholder = site.searchPlaceholder;

  const dc = $('#discordLink');
  if (site.discordUrl) dc.href = site.discordUrl;
  else dc.hidden = true;
}

/* ---------- rendu ---------- */
function renderRules(items) {
  return items.map(it => {
    const html = fmt(it.x);
    switch (it.t) {
      case 'subhead': return `<p class="subhead">${html}</p>`;
      case 'note':    return `<p class="note">${html}</p>`;
      case 'warn':    return `<p class="note warn">${html}</p>`;
      case 'sub':     return `<p class="rule sub">${html}</p>`;
      default:        return `<p class="rule">${html}</p>`;
    }
  }).join('');
}

function render() {
  $('#catList').innerHTML = sections.map(s => {
    const n = s.items.filter(i => i.t !== 'subhead').length;
    return `
<section class="cat" id="${s.id}" data-id="${s.id}">
  <div class="cat-head" role="button" tabindex="0" aria-expanded="false">
    <span class="cat-emoji">${esc(s.emoji || '📌')}</span>
    <h2 class="cat-title">${esc(s.titre)}</h2>
    <span class="cat-count">${n}</span>
    <button class="cat-copy" title="Copier le lien de la section" aria-label="Copier le lien">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>
    </button>
    <svg class="cat-chevron" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
  </div>
  <div class="cat-body"><div class="cat-body-inner"><div class="cat-content">${renderRules(s.items)}</div></div></div>
</section>`;
  }).join('');

  $('#tocList').innerHTML = sections.map(s =>
    `<a href="#${s.id}" data-id="${s.id}"><span class="toc-emoji">${esc(s.emoji || '📌')}</span><span class="toc-label">${esc(s.titre)}</span></a>`
  ).join('');

  $('#statSections').textContent = sections.length;
  $('#statRules').textContent = sections.reduce((a, s) => a + s.items.filter(i => i.t !== 'subhead').length, 0);
}

/* ---------- ouverture / fermeture ---------- */
const openCat  = el => { el.classList.add('open');  el.querySelector('.cat-head').setAttribute('aria-expanded', 'true'); };
const closeCat = el => { el.classList.remove('open'); el.querySelector('.cat-head').setAttribute('aria-expanded', 'false'); };
const toggleCat = el => el.classList.contains('open') ? closeCat(el) : openCat(el);

function syncExpandBtn() {
  const cats = $$('.cat:not([hidden])');
  const allOpen = cats.length > 0 && cats.every(c => c.classList.contains('open'));
  $('#expandBtn').textContent = allOpen ? 'Tout replier' : 'Tout déplier';
  return allOpen;
}

/* ---------- recherche ---------- */
function clearMarks(cat) {
  $$('mark', cat).forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  cat.normalize();
}

function highlight(cat, q) {
  const walker = document.createTreeWalker(cat.querySelector('.cat-content'), NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) {
    if (norm(walker.currentNode.nodeValue).includes(q)) targets.push(walker.currentNode);
  }
  targets.forEach(node => {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    const hay = norm(text);
    let i = 0, pos;
    while ((pos = hay.indexOf(q, i)) !== -1) {
      frag.append(text.slice(i, pos));
      const m = document.createElement('mark');
      m.textContent = text.slice(pos, pos + q.length);
      frag.append(m);
      i = pos + q.length;
    }
    frag.append(text.slice(i));
    node.replaceWith(frag);
  });
}

function search(raw) {
  const q = norm(raw.trim());
  const cats = $$('.cat');
  cats.forEach(clearMarks);

  if (!q) {
    cats.forEach(c => { c.hidden = false; closeCat(c); });
    $('#searchScope').classList.remove('on');
    $('#emptyState').hidden = true;
    syncExpandBtn();
    return;
  }

  let hits = 0, shown = 0;
  cats.forEach(cat => {
    const s = sections.find(x => x.id === cat.dataset.id);
    const matching = s.items.filter(i => norm(i.x).includes(q)).length;

    if (norm(s.titre).includes(q) || matching) {
      cat.hidden = false;
      openCat(cat);
      highlight(cat, q);
      hits += matching;
      shown++;
    } else {
      cat.hidden = true;
      closeCat(cat);
    }
  });

  const scope = $('#searchScope');
  scope.textContent = shown
    ? `${hits} résultat${hits > 1 ? 's' : ''} dans ${shown} section${shown > 1 ? 's' : ''}`
    : 'Aucun résultat';
  scope.classList.add('on');
  $('#emptyState').hidden = shown > 0;
  syncExpandBtn();
}

/* ---------- scrollspy ---------- */
function spy() {
  const top = $('.topbar').offsetHeight + 30;
  let current = null;
  $$('.cat:not([hidden])').forEach(c => { if (c.getBoundingClientRect().top <= top) current = c.dataset.id; });
  $$('#tocList a').forEach(a => a.classList.toggle('active', a.dataset.id === current));
}

/* ---------- ancres ---------- */
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const cat = id && document.getElementById(id);
  if (!cat || !cat.classList.contains('cat')) return;
  openCat(cat);
  syncExpandBtn();
  cat.scrollIntoView({ block: 'start' });
  cat.classList.add('flash');
  setTimeout(() => cat.classList.remove('flash'), 1600);
}

/* ============================================================
   ÉVÉNEMENTS
   ============================================================ */
$('#catList').addEventListener('click', e => {
  const copy = e.target.closest('.cat-copy');
  const cat  = e.target.closest('.cat');
  if (!cat) return;

  if (copy) {
    e.stopPropagation();
    const url = location.origin + location.pathname + '#' + cat.id;
    copyText(url).then(ok => {
      if (ok) {
        copy.classList.add('done');
        setTimeout(() => copy.classList.remove('done'), 1400);
        toast('Lien de la section copié');
      } else {
        // dernier recours : on sélectionne le lien pour un Ctrl+C manuel
        prompt('Copie ce lien :', url);
      }
    });
    return;
  }
  if (e.target.closest('.cat-head')) { toggleCat(cat); syncExpandBtn(); }
});

$('#catList').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const head = e.target.closest('.cat-head');
  if (!head) return;
  e.preventDefault();
  toggleCat(head.closest('.cat'));
  syncExpandBtn();
});

$('#tocList').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a) return;
  const cat = document.getElementById(a.dataset.id);
  if (cat) { openCat(cat); syncExpandBtn(); }
  $('#toc').classList.remove('open');
});

$('#tocOpen').addEventListener('click', () => $('#toc').classList.add('open'));
$('#tocClose').addEventListener('click', () => $('#toc').classList.remove('open'));

$('#expandBtn').addEventListener('click', () => {
  const cats = $$('.cat:not([hidden])');
  const allOpen = cats.every(c => c.classList.contains('open'));
  cats.forEach(c => allOpen ? closeCat(c) : openCat(c));
  syncExpandBtn();
});

let searchTimer;
$('#searchInput').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => search(v), 120);
});

document.addEventListener('keydown', e => {
  const input = $('#searchInput');
  if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); }
  if (e.key === 'Escape') {
    if ($('#toc').classList.contains('open')) return $('#toc').classList.remove('open');
    if (document.activeElement === input) { input.value = ''; search(''); input.blur(); }
  }
});

$('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    $('#toTop').classList.toggle('on', window.scrollY > 500);
    spy();
    ticking = false;
  });
}, { passive: true });

// Ctrl+P : le règlement s'imprime entièrement déplié
window.addEventListener('beforeprint', () => {
  $$('.cat').forEach(c => { c.hidden = false; openCat(c); });
  syncExpandBtn();
});

window.addEventListener('hashchange', openFromHash);

/* ============================================================
   CHARGEMENT
   ============================================================ */
(async () => {
  try {
    const res = await fetch('/api/content', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();

    applySite(data.site);

    // identifiants d'ancre uniques, dérivés du titre
    const seen = new Map();
    sections = (data.sections || []).map(s => {
      const base = slugify(s.titre);
      const n = (seen.get(base) || 0) + 1;
      seen.set(base, n);
      return { ...s, id: n === 1 ? base : `${base}-${n}` };
    });

    render();
    openFromHash();
    spy();
  } catch (e) {
    $('#catList').innerHTML =
      '<div class="state">Le règlement n’a pas pu être chargé. Réessaie dans un instant.</div>';
    console.error(e);
  }
})();

})();
