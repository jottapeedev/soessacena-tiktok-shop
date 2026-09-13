/* ============================================================
   SÓESSACENA | TIKTOK SHOP — app.js (parte 1: núcleo)
   SPA em JS puro. Comunicação: Supabase (PostgREST + RPC).
   ============================================================ */
'use strict';

/* ---------- 0. ESTADO ---------- */
var state = {
  data: null,
  installed: false,
  loading: false,
  period: '30',
  dashF: { categoria: '', status: '' },
  esteira: { modo: 'kanban', f: { q: '', status: '', classif: '', cat: '', prio: '' } },
  cadastro: { f: { q: '', cat: '', status: '', prio: '' } },
  conteudos: { f: { q: '', produto: '', cat: '', status: '', tipo: '', period: '' }, sort: { key: 'data', dir: -1 } },
  cortes: { f: 'todos', q: '' },
  comissaoTocado: false,
  agenda: { ano: 0, mes: 0, sel: '', filtro: '' },
  vendasF: { produto: '' }
};
var currentView = 'dashboard';

/* ---------- 0b. ARMAZÉM EXTRA (agenda do casal + perfil TikTok) ----------
   Salvo no localStorage em qualquer modo (local ou Supabase). */
var ExtraStore = {
  KEY: 'ssc_extra_v1',
  state: null,
  _seedTasks: function() {
    function d(off) {
      var x = new Date(); x.setDate(x.getDate() + off);
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }
    return [
      { id: 'T-0001', titulo: 'Gravar 2 vídeos do produto campeão', dono: 'JottaPe', data: d(0), hora: '09:00', cat: 'Gravação', prio: '🔥 Alta', done: false, obs: '' },
      { id: 'T-0002', titulo: 'Editar vídeo de ontem (corte + legenda)', dono: 'JottaPe', data: d(0), hora: '14:00', cat: 'Edição', prio: '🟡 Média', done: false, obs: '' },
      { id: 'T-0003', titulo: 'Compras do mercado', dono: 'Suzana', data: d(0), hora: '18:00', cat: 'Casa', prio: '🟡 Média', done: false, obs: '' },
      { id: 'T-0004', titulo: 'Publicar vídeo às 19h', dono: 'JottaPe', data: d(1), hora: '19:00', cat: 'Postagem', prio: '🔥 Alta', done: false, obs: '' },
      { id: 'T-0005', titulo: 'Responder comentários e directs', dono: 'Suzana', data: d(1), hora: '12:00', cat: 'Trabalho', prio: '⚪ Baixa', done: false, obs: '' },
      { id: 'T-0006', titulo: 'Pagar conta de energia', dono: 'Suzana', data: d(2), hora: '', cat: 'Casa', prio: '🔥 Alta', done: false, obs: '' }
    ];
  },
  load: function() {
    if (this.state) return this.state;
    try {
      var raw = localStorage.getItem(this.KEY);
      if (raw) { this.state = JSON.parse(raw); }
    } catch (e) { this.state = null; }
    if (!this.state || typeof this.state !== 'object') this.state = {};
    if (!Array.isArray(this.state.tarefas)) this.state.tarefas = [];
    if (!this.state.perfil) this.state.perfil = {};
    if (!this.state.seedTarefas) {
      if (this.state.tarefas.length === 0) this.state.tarefas = this._seedTasks();
      this.state.seedTarefas = true;
    }
    this.save();
    return this.state;
  },
  save: function() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.state)); } catch (e) {}
  },
  nextTaskId: function() {
    var mx = 0;
    this.state.tarefas.forEach(function(t) {
      var m = String(t.id || '').match(/(\d+)$/);
      if (m && Number(m[1]) > mx) mx = Number(m[1]);
    });
    return 'T-' + String(mx + 1).padStart(4, '0');
  }
};

/* ---------- 0c. LINK DE VÍDEO → ID para embed do TikTok ---------- */
function tiktokVideoId(url) {
  var s = String(url || '').trim();
  if (!s) return null;
  var m = s.match(/\/(?:video|photo)\/(\d{5,})/);
  if (m) return m[1];
  m = s.match(/[?&]id=(\d{5,})/);
  return m ? m[1] : null;
}

/* ---------- 1. API (Supabase via fetch) ---------- */
var LOCAL_MODE_ = (typeof LOCAL_MODE !== 'undefined') && LOCAL_MODE;
var API = {
  configured: function() { return LOCAL_MODE_ ? true : !!(SUPABASE_URL && SUPABASE_ANON_KEY); },
  rpc: function(fn, args) {
    if (LOCAL_MODE_) {
      if (typeof LOCALDB === 'undefined') return Promise.reject(new Error('localdb.js não carregou. Verifique se o arquivo está na pasta web/.'));
      return LOCALDB.rpc(fn, args);
    }
    if (!this.configured()) return Promise.reject(new Error('Supabase não configurado (edite web/config.js).'));
    var url = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
    // As funções RPC do Supabase recebem UM único parâmetro JSON chamado "p".
    // Chamadas sem argumentos (get_bundle, diagnostico_sistema, popular_dados_demo) não enviam corpo.
    var body = (args === undefined || args === null) ? undefined : JSON.stringify({ p: args });
    return fetch(url, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: body
    }).then(function(r) {
      return r.json().then(function(j) {
        if (!r.ok) {
          var msg = (j && (j.message || j.detail)) || ('HTTP ' + r.status);
          throw new Error(msg);
        }
        if (Array.isArray(j)) return j[0];
        return j;
      });
    }).catch(function(e) {
      if (e && e.message) throw e;
      throw new Error('Falha de rede ao falar com o Supabase.');
    });
  }
};

/* ---------- 2. UTILITÁRIOS ---------- */
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function parseDec(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  var s = String(v).replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function arred2(v) { return Math.round(num(v) * 100) / 100; }
function fmtMoeda(v) {
  return 'R$ ' + num(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(v) { return num(v).toLocaleString('pt-BR'); }
function fmtCompact(v) {
  v = num(v);
  if (v >= 1000000) return (v / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi';
  if (v >= 1000) return (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return String(Math.round(v));
}
function hojeISO() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dataMenosDias(n) {
  var d = new Date(); d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtData(iso) {
  if (!iso) return '—';
  var p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return String(iso);
  return p[2] + '/' + p[1] + '/' + p[0];
}
function fmtDataHora(s) {
  if (!s) return '—';
  var d = String(s).slice(0, 16);
  return fmtData(d) + ' ' + d.slice(11, 16);
}
function normKey(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function semEmoji(s) {
  return String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim();
}

/* Status de conteúdo que significam "vídeo já lançado/publicado" */
var STATUS_LANCADOS = ['📤 Publicado', '📊 Em análise', '🏆 Vencedor'];
function lancadosPorProduto_() {
  var m = {};
  (state.data.produtos || []).forEach(function(p) { m[p.id] = { total: 0, lanc: 0 }; });
  (state.data.conteudos || []).forEach(function(c) {
    var e = m[c.produtoId];
    if (!e || c.status === '❌ Arquivado') return;
    e.total++;
    if (STATUS_LANCADOS.indexOf(c.status) !== -1) e.lanc++;
  });
  return m;
}
var lancMap_ = {};
function debounce(fn, ms) {
  var t;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(t);
    t = setTimeout(function() { fn.apply(ctx, args); }, ms);
  };
}
function countUp(el, target, fmt) {
  var t0 = performance.now(), dur = 650;
  function step(t) {
    var k = Math.min(1, (t - t0) / dur);
    k = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(target * k);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- 3. ÍCONES (SVG inline) ---------- */
var ICONS = {
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 12 7.5 3 3v18l9 4.5L21 21z"/><path d="M3 3l9 4.5L21 3M12 22.5V7.5"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 7-6.5 2L9 18.5z"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8h12l-1 13H7L6 8z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 5H4.5a3.5 3.5 0 0 0 3.6 4M16 5h3.5a3.5 3.5 0 0 1-3.6 4M12 13v4M8.5 21h7M10 17h4l1 4H9z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9.5" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/><path d="M3 4.5h2.2L8 15.5h10.3L20.8 8H6"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.3c-.5-1-1.5-1.6-2.8-1.6-1.8 0-3.2 1-3.2 2.2 0 3 6.2 1.6 6.2 4.6 0 1.3-1.4 2.3-3 2.3-1.4 0-2.6-.7-3-1.8M12 6.5v11"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M10 8.8l5 3.2-5 3.2z"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5M12 17.4v.4"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.8.6 1.5 1.7 1.5 2.6v.5h4v-.5c0-.9.7-2 1.5-2.6A6 6 0 0 0 12 3z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 6 .4l2.5-2.5a4 4 0 1 0-5.7-5.7L11.5 7.5"/><path d="M14 10a4 4 0 0 0-6-.4L5.5 12a4 4 0 1 0 5.7 5.7l1.3-1.3"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5 10 18 19.5 6.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.6v.4"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10.5h17"/><path d="m9.6 15.4 1.8 1.8 3.4-3.6"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-9.3-9A5.4 5.4 0 0 1 12 6.6 5.4 5.4 0 0 1 21.3 11c-1.8 4.4-9.3 9-9.3 9z"/></svg>'
};

/* ---------- 4. TOASTS ---------- */
function toast(msg, tipo) {
  var tipos = {
    success: { ic: ICONS.check, cls: 'success' },
    error: { ic: ICONS.close, cls: 'error' },
    info: { ic: ICONS.info, cls: 'info' },
    warn: { ic: ICONS.alert, cls: 'warn' }
  };
  var t = tipos[tipo] || tipos.info;
  var el = document.createElement('div');
  el.className = 'toast ' + t.cls;
  el.innerHTML = '<span class="toast-ic">' + t.ic + '</span><div>' + esc(msg) + '</div>';
  var root = $('#toast-root');
  root.appendChild(el);
  while (root.children.length > 4) root.removeChild(root.firstChild);
  setTimeout(function() {
    el.classList.add('out');
    setTimeout(function() { el.remove(); }, 320);
  }, 3600);
}

/* ---------- 5. LOADING (barra top + estado) ---------- */
function loading_(on) {
  state.loading = on;
  var bar = $('#top-progress');
  if (bar) bar.className = 'top-progress' + (on ? ' on' : ' done');
  var app = $('#app');
  if (app) app.classList.toggle('refreshing', on);
  setTimeout(function() { if (!state.loading && bar) bar.className = 'top-progress'; }, 600);
}

/* ---------- 6. MODAIS ---------- */
function openModal(html, opts) {
  opts = opts || {};
  var root = $('#modal-root');
  root.innerHTML =
    '<div class="modal-backdrop">' +
      '<div class="modal' + (opts.wide ? ' wide' : '') + (opts.xl ? ' xl' : '') + '">' +
        '<div class="modal-head">' +
          (opts.title ? '<h3>' + esc(opts.title) + '</h3>' : '<span></span>') +
          '<button class="icon-btn" data-close title="Fechar">' + ICONS.close + '</button>' +
        '</div>' +
        '<div class="modal-body">' + html + '</div>' +
        (opts.foot ? '<div class="modal-foot">' + opts.foot + '</div>' : '') +
      '</div>' +
    '</div>';
  $$('#modal-root [data-close]').forEach(function(b) { b.addEventListener('click', closeModal); });
  var bd = root.firstElementChild;
  bd.addEventListener('mousedown', function(e) { if (e.target === bd && !opts.sticky) closeModal(); });
  document.addEventListener('keydown', _escClose);
  if (opts.onMount) opts.onMount(root);
  return root;
}
function _escClose(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  $('#modal-root').innerHTML = '';
  document.removeEventListener('keydown', _escClose);
}
function confirmar(msg, okLabel, cb, danger) {
  openModal(
    '<p class="confirm-txt">' + msg + '</p>',
    {
      title: danger ? 'Confirmar ação' : 'Confirmar',
      foot: '<button class="btn btn-ghost" data-close>Cancelar</button>' +
            '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="cfm-ok">' + esc(okLabel || 'Confirmar') + '</button>'
    }
  );
  $('#cfm-ok').addEventListener('click', function() {
    closeModal();
    cb();
  });
}

/* ---------- 7. BADGES ---------- */
var CLASSIF_INFO = {
  'campeao': { label: 'Campeão', cls: 'b-gold-strong' },
  'promissor': { label: 'Promissor', cls: 'b-cyan' },
  'emteste': { label: 'Em teste', cls: 'b-yellow' },
  'reposicionar': { label: 'Reposicionar', cls: 'b-orange' },
  'fraco': { label: 'Fraco', cls: 'b-red' },
  'descartado': { label: 'Descartado', cls: 'b-gray' }
};
function badgeClassif(cl) {
  var k = normKey(cl);
  if (k.indexOf('campeao') > -1) return '<span class="badge b-gold-strong"><span class="bdot"></span>🟢 CAMPEÃO</span>';
  for (var key in CLASSIF_INFO) {
    if (k.indexOf(key) > -1) {
      var i = CLASSIF_INFO[key];
      var emoji = cl.split(' ')[0];
      return '<span class="badge ' + i.cls + '">' + esc(cl) + '</span>';
    }
  }
  return '<span class="badge b-gray">' + esc(cl || '—') + '</span>';
}
function badgeStatus(st) {
  var k = normKey(st);
  if (k.indexOf('descartado') > -1) return '<span class="badge b-gray"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('escalando') > -1 || k.indexOf('campe') > -1) return '<span class="badge b-green"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('pausado') > -1) return '<span class="badge b-gray"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('teste') > -1 || k.indexOf('retestar') > -1) return '<span class="badge b-orange"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('producao') > -1 || k.indexOf('editacao') > -1) return '<span class="badge b-violet"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('publicado') > -1) return '<span class="badge b-blue"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('analise') > -1) return '<span class="badge b-cyan"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('vencedor') > -1) return '<span class="badge b-gold"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('novo') > -1 || k.indexOf('ideia') > -1) return '<span class="badge b-purple"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('roteiro') > -1 || k.indexOf('agendado') > -1) return '<span class="badge b-yellow"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('aprovado') > -1) return '<span class="badge b-green"><span class="bdot"></span>' + esc(st) + '</span>';
  if (k.indexOf('solicitado') > -1 || k.indexOf('aguardando') > -1) return '<span class="badge b-blue"><span class="bdot"></span>' + esc(st) + '</span>';
  return '<span class="badge b-gray"><span class="bdot"></span>' + esc(st || '—') + '</span>';
}
function prioBadge(p) {
  var k = normKey(p);
  if (k.indexOf('alta') > -1) return '<span class="badge b-red" title="Prioridade alta">🔥 Alta</span>';
  if (k.indexOf('media') > -1) return '<span class="badge b-yellow" title="Prioridade média">🟡 Média</span>';
  return '<span class="badge b-gray" title="Prioridade baixa">⚪ Baixa</span>';
}

var GRADS = ['', 'gold', 'blue', 'violet'];

/* ---------- 8. KANBAN: colunas ---------- */
var KANBAN_COLS = [
  { key: 'novo', rotulo: 'Novo', cor: 'var(--purple)', teste: 'novo' },
  { key: 'analise', rotulo: 'Em análise', cor: 'var(--blue)', teste: 'analise' },
  { key: 'aprovado', rotulo: 'Aprovado', cor: 'var(--cyan)' },
  { key: 'producao', rotulo: 'Produção', cor: 'var(--violet)', teste: 'producao' },
  { key: 'teste', rotulo: 'Em teste', cor: 'var(--orange)', teste: 'teste' },
  { key: 'escalando', rotulo: 'Escalando', cor: 'var(--green)', teste: 'escalando' },
  { key: 'campeoes', rotulo: 'Campeões', cor: 'var(--gold)' },
  { key: 'descartados', rotulo: 'Descartados', cor: 'var(--text-3)' }
];
function colunaDe(p) {
  var cl = normKey(p.classificacao);
  var st = normKey(p.status);
  if (cl.indexOf('descartado') > -1) return 'descartados';
  if (cl.indexOf('campeao') > -1) return 'campeoes';
  for (var i = 0; i < KANBAN_COLS.length; i++) {
    var c = KANBAN_COLS[i];
    if (c.teste && st.indexOf(c.teste) > -1) return c.key;
  }
  if (st.indexOf('aprovado') > -1) return 'aprovado';
  return 'novo';
}

/* ---------- 9. GRÁFICOS (SVG próprios) ---------- */
function emptyChart(msg) {
  return '<div class="lc-empty">' + esc(msg || 'Sem dados no período.') + '</div>';
}
function lineChart(el, serie, opts) {
  opts = opts || {};
  var W = 640, H = 200, P = { t: 14, r: 14, b: 26, l: 44 };
  var n = serie.length;
  if (!n) { el.innerHTML = emptyChart(); return; }
  var maxV = 0;
  serie.forEach(function(s) { if (s.v > maxV) maxV = s.v; });
  if (maxV === 0) { el.innerHTML = emptyChart(); return; }
  maxV *= 1.12;
  var iw = W - P.l - P.r, ih = H - P.t - P.b;
  function x(i) { return P.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw); }
  function y(v) { return P.t + ih - (v / maxV) * ih; }
  var cor = opts.cor || '#2ee6c8';
  var gradId = 'grad' + (opts.gold ? 'g' : 'a') + Math.floor(Math.random() * 1e5);
  var d = serie.map(function(s, i) { return (i === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(s.v).toFixed(1); }).join(' ');
  var area = d + ' L' + x(n - 1).toFixed(1) + ',' + (P.t + ih) + ' L' + x(0).toFixed(1) + ',' + (P.t + ih) + ' Z';
  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:100%;display:block" preserveAspectRatio="none">' +
    '<defs><linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="' + cor + '" stop-opacity=".28"/><stop offset="1" stop-color="' + cor + '" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<g stroke="rgba(255,255,255,.06)" stroke-width="1">';
  for (var g = 0; g <= 3; g++) {
    var gy = P.t + (ih / 3) * g;
    svg += '<line x1="' + P.l + '" y1="' + gy + '" x2="' + (W - P.r) + '" y2="' + gy + '"/>';
  }
  svg += '</g>';
  svg += '<path class="lc-area" d="' + area + '" fill="url(#' + gradId + ')"/>';
  svg += '<path class="lc-line' + (opts.gold ? ' gold' : '') + '" d="' + d + '" fill="none" stroke="' + cor + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
  var step = Math.max(1, Math.ceil(n / 6));
  for (var i = 0; i < n; i++) {
    if (i % step === 0 || i === n - 1) {
      svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" font-size="10.5" fill="#67718a" text-anchor="middle" font-family="Inter">' + esc(serie[i].l) + '</text>';
    }
  }
  var stepY = Math.max(1, Math.ceil(4 / 4));
  for (var gy2 = 0; gy2 <= 3; gy2++) {
    var val = (maxV / 1.12) * (1 - gy2 / 3);
    var gy3 = P.t + (ih / 3) * gy2;
    svg += '<text x="' + (P.l - 7) + '" y="' + (gy3 + 3.5) + '" font-size="10" fill="#67718a" text-anchor="end" font-family="Inter">' +
      (opts.moeda ? fmtCompact(val) : fmtCompact(val)) + '</text>';
  }
  serie.forEach(function(s, i) {
    svg += '<circle class="lc-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(s.v).toFixed(1) + '" r="7" fill="transparent" stroke="none" data-i="' + i + '"/>';
  });
  svg += '</svg><div class="lc-tip" id="lc-tip-' + (opts.gold ? 'g' : 'a') + '"></div>';
  el.innerHTML = svg;
  var tip = el.querySelector('.lc-tip');
  el.querySelectorAll('.lc-dot').forEach(function(c) {
    c.addEventListener('mouseenter', function() {
      var i = num(c.getAttribute('data-i'));
      var s = serie[i];
      tip.innerHTML = '<b>' + esc(s.l) + '</b><span>' + (opts.moeda ? fmtMoeda(s.v) : fmtInt(s.v)) + ' ' + (opts.sufixo || '') + '</span>';
      var rect = el.getBoundingClientRect();
      var cx = (num(c.getAttribute('cx')) / W) * rect.width;
      var cy = (num(c.getAttribute('cy')) / H) * rect.height;
      tip.style.left = Math.max(46, Math.min(rect.width - 46, cx)) + 'px';
      tip.style.top = (cy - 6) + 'px';
      tip.classList.add('on');
    });
    c.addEventListener('mouseleave', function() { tip.classList.remove('on'); });
  });
}
function donut(el, items) {
  var total = items.reduce(function(a, b) { return a + b.total; }, 0);
  if (!total) { el.innerHTML = emptyChart('Nenhum produto ainda.'); return; }
  var R = 52, C = 2 * Math.PI * R;
  var svg = '<div class="dn-wrap"><svg viewBox="0 0 140 140" width="150" height="150">' +
    '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="17"/>';
  var off = 0;
  items.forEach(function(it, i) {
    if (!it.total) return;
    var frac = it.total / total;
    svg += '<circle class="dn-seg" cx="70" cy="70" r="' + R + '" fill="none" stroke="' + it.cor + '" stroke-width="17" ' +
      'stroke-dasharray="' + (frac * C).toFixed(2) + ' ' + (C - frac * C).toFixed(2) + '" ' +
      'stroke-dashoffset="' + (-off * C).toFixed(2) + '" transform="rotate(-90 70 70)" stroke-linecap="butt"/>';
    off += frac;
  });
  svg += '<text class="dn-center-num" x="70" y="68">' + total + '</text>' +
         '<text class="dn-center-lbl" x="70" y="86">produtos</text></svg>';
  svg += '<div class="dn-legend">';
  items.forEach(function(it) {
    svg += '<div class="dn-li"><span class="dn-dot" style="background:' + it.cor + '"></span>' +
      '<span class="dn-li-txt">' + esc(it.label) + '</span><span class="dn-li-num">' + it.total + '</span></div>';
  });
  svg += '</div></div>';
  el.innerHTML = svg;
}
function bars(el, items, opts) {
  opts = opts || {};
  if (!items.length) { el.innerHTML = emptyChart(); return; }
  var max = 0;
  items.forEach(function(i) { if (i.v > max) max = i.v; });
  var html = '';
  items.forEach(function(i, ix) {
    var w = max ? Math.max(2, (i.v / max) * 100) : 0;
    html += '<div class="cat-row">' +
      '<div class="cat-top"><span class="cat-name">' + esc(i.nome) + '</span>' +
      '<span class="cat-nums">' + esc(i.sub || '') + ' <b>' + (opts.moeda ? fmtMoeda(i.v) : fmtInt(i.v)) + '</b></span></div>' +
      '<div class="cat-bar"><div class="cat-fill ' + (i.cls || (opts.grads ? opts.grads[ix % opts.grads.length] : '')) + '" data-w="' + w.toFixed(1) + '"></div></div>' +
      '</div>';
  });
  el.innerHTML = html;
  requestAnimationFrame(function() {
    el.querySelectorAll('.cat-fill').forEach(function(f) { f.style.width = f.getAttribute('data-w') + '%'; });
  });
}

/* ---------- 10. VAZIO / HERO ---------- */
function heroHtml(ic, title, sub, cta) {
  return '<div class="hero-empty"><div class="hero-ic">' + (ic || '🎬') + '</div>' +
    '<h3>' + esc(title) + '</h3><p>' + esc(sub) + '</p>' +
    (cta ? '<div class="hero-actions">' + cta + '</div>' : '') + '</div>';
}
function emptyHtml(msg) {
  return '<div class="list-empty-big">' + esc(msg) + '</div>';
}

/* ============================================================
   11. DASHBOARD — agregação no cliente (mesma regra do backend)
   ============================================================ */
function periodoInfo(period) {
  var dias = period === 'all' ? null : parseInt(period, 10);
  if (!dias) dias = null;
  var inicio = dias ? dataMenosDias(dias - 1) : null;
  return { dias: dias, inicio: inicio };
}
function calcularDashboard(b, period, filtros) {
  var cfg = b.config || {};
  var regras = cfg.regras || {};
  var hoje = hojeISO();
  var P = (b.produtos || []).filter(function(p) {
    if (filtros.categoria && p.categoria !== filtros.categoria) return false;
    if (filtros.status && p.status !== filtros.status) return false;
    return true;
  });
  var idsP = {};
  P.forEach(function(p) { idsP[p.id] = p; });
  var pi = periodoInfo(period);

  var C = (b.conteudos || []).filter(function(c) {
    if (!idsP[c.produtoId]) return false;
    if (c.status === '❌ Arquivado') return false;
    var d = String(c.data || '').slice(0, 10);
    if (!d) return false;
    if (pi.inicio && d < pi.inicio) return false;
    return true;
  });

  // ----- KPIs -----
  var kpis = { comissao: 0, vendas: 0, visualizacoes: 0, clicks: 0, carrinhos: 0, conteudosPublicados: 0, produtosAtivos: 0, campeoes: 0 };
  C.forEach(function(c) {
    kpis.comissao += num(c.comissao);
    kpis.vendas += num(c.vendas);
    kpis.visualizacoes += num(c.views);
    kpis.clicks += num(c.clicks);
    kpis.carrinhos += num(c.carrinhos);
    var st = normKey(c.status);
    if (st.indexOf('publicado') > -1 || st.indexOf('analise') > -1 || st.indexOf('vencedor') > -1) kpis.conteudosPublicados++;
  });
  P.forEach(function(p) {
    var st = normKey(p.status), cl = normKey(p.classificacao);
    if (st.indexOf('descartado') === -1 && cl.indexOf('descartado') === -1) kpis.produtosAtivos++;
    if (cl.indexOf('campeao') > -1) kpis.campeoes++;
  });
  kpis.comissao = arred2(kpis.comissao);

  var comissaoDelta = null;
  if (pi.dias) {
    var fimPrev = dataMenosDias(pi.dias);
    var iniPrev = dataMenosDias(pi.dias * 2 - 1);
    var prev = 0;
    (b.conteudos || []).forEach(function(c) {
      if (!idsP[c.produtoId]) return;
      if (c.status === '❌ Arquivado') return;
      var d = String(c.data || '').slice(0, 10);
      if (d && d >= iniPrev && d <= fimPrev) prev += num(c.comissao);
    });
    if (prev > 0) comissaoDelta = Math.round((kpis.comissao - prev) / prev * 100);
  }

  // ----- séries diárias -----
  function serieTempo(rows) {
    if (!pi.dias || pi.dias < 14) {
      var mapa = {};
      rows.forEach(function(c) {
        var d = String(c.data || '').slice(0, 10);
        if (!d) return;
        mapa[d] = mapa[d] || { l: fmtData(d).slice(0, 5), v: 0 };
        mapa[d].v += num(c.vendas);
      });
      return Object.keys(mapa).sort().slice(-12).map(function(k) { return mapa[k]; });
    }
    var out = [];
    for (var i = pi.dias - 1; i >= 0; i--) {
      var ds = dataMenosDias(i);
      out.push({ l: fmtData(ds).slice(0, 5), v: 0, _d: ds });
    }
    rows.forEach(function(c) {
      var d = String(c.data || '').slice(0, 10);
      for (var j = 0; j < out.length; j++) if (out[j]._d === d) { out[j].v += num(c.vendas); break; }
    });
    return out;
  }
  var serieVendas = serieTempo(C);
  var serieComissao = (function() {
    if (!pi.dias || pi.dias < 14) {
      var mapa = {};
      C.forEach(function(c) {
        var d = String(c.data || '').slice(0, 10);
        if (!d) return;
        mapa[d] = mapa[d] || { l: fmtData(d).slice(0, 5), v: 0 };
        mapa[d].v += num(c.comissao);
      });
      return Object.keys(mapa).sort().slice(-12).map(function(k) { return mapa[k]; });
    }
    var out = [];
    for (var i = pi.dias - 1; i >= 0; i--) { var ds = dataMenosDias(i); out.push({ l: fmtData(ds).slice(0, 5), v: 0, _d: ds }); }
    C.forEach(function(c) {
      var d = String(c.data || '').slice(0, 10);
      for (var j = 0; j < out.length; j++) if (out[j]._d === d) { out[j].v += arred2(c.comissao); break; }
    });
    return out;
  })();

  // ----- classificação -----
  var classif = ((b.listas && b.listas.classificacoes) || []).map(function(nome) { return { key: nome, total: 0 }; });
  classif.push({ key: '— Sem classificação', total: 0 });
  var COR_CLASSIF = ['#f4b942', '#2ee6c8', '#ffd166', '#ff9d5c', '#ff5d6c', '#67718a', '#3a4157'];
  P.forEach(function(p) {
    var achou = false;
    for (var i = 0; i < classif.length; i++) {
      if (classif[i].key === p.classificacao) { classif[i].total++; achou = true; break; }
    }
    if (!achou) classif[classif.length - 1].total++;
  });

  // ----- por produto (período) -----
  var porProduto = {};
  C.forEach(function(c) {
    porProduto[c.produtoId] = porProduto[c.produtoId] || { videos: 0, vendas: 0, comissao: 0 };
    porProduto[c.produtoId].videos++;
    porProduto[c.produtoId].vendas += num(c.vendas);
    porProduto[c.produtoId].comissao += num(c.comissao);
  });

  // ----- categorias -----
  var catMap = {};
  C.forEach(function(c) {
    var p = idsP[c.produtoId];
    var cat = p ? (p.categoria || 'Outro') : 'Outro';
    catMap[cat] = catMap[cat] || { videos: 0, vendas: 0, comissao: 0 };
    catMap[cat].videos++;
    catMap[cat].vendas += num(c.vendas);
    catMap[cat].comissao += num(c.comissao);
  });
  var categorias = Object.keys(catMap).map(function(k) {
    return { categoria: k, videos: catMap[k].videos, vendas: catMap[k].vendas, comissao: arred2(catMap[k].comissao) };
  }).sort(function(a, z) { return z.comissao - a.comissao; }).slice(0, 8);

  // ----- top produtos -----
  var tops = P.map(function(p) {
    var a = porProduto[p.id] || { videos: 0, vendas: 0, comissao: 0 };
    return { id: p.id, produto: p.produto, categoria: p.categoria, classificacao: p.classificacao,
      status: p.status, videos: a.videos, vendas: a.vendas, comissao: arred2(a.comissao) };
  })
  .filter(function(x) { return x.vendas > 0 || x.videos > 0; })
  .sort(function(a, z) { return (z.vendas - a.vendas) || (z.comissao - a.comissao); })
  .slice(0, 5);
  var maxV = 0, maxC = 0;
  tops.forEach(function(t) { if (t.vendas > maxV) maxV = t.vendas; if (t.comissao > maxC) maxC = t.comissao; });
  tops.forEach(function(t) {
    t.perf = Math.round((maxV ? (t.vendas / maxV) * 60 : 0) + (maxC ? (t.comissao / maxC) * 40 : 0));
  });

  // ----- top conteúdos -----
  var topC = C.map(function(c) {
    return { id: c.id, titulo: c.titulo, produto: c.produto, gancho: c.gancho, tipo: c.tipo,
      status: c.status, views: num(c.views), vendas: num(c.vendas), comissao: arred2(c.comissao) };
  })
  .filter(function(x) { return x.vendas > 0 || x.views > 0; })
  .sort(function(a, z) { return (z.vendas - a.vendas) || (z.comissao - a.comissao); })
  .slice(0, 5);
  var maxCV = 0, maxCC = 0;
  topC.forEach(function(t) { if (t.vendas > maxCV) maxCV = t.vendas; if (t.comissao > maxCC) maxCC = t.comissao; });
  topC.forEach(function(t) {
    t.perf = Math.round((maxCV ? (t.vendas / maxCV) * 60 : 0) + (maxCC ? (t.comissao / maxCC) * 40 : 0));
  });

  // ----- metas do mês -----
  var agora = new Date();
  var iniMes = agora.getFullYear() + '-' + String(agora.getMonth() + 1).padStart(2, '0') + '-01';
  var bMes = (b.conteudos || []).filter(function(c) {
    if (c.status === '❌ Arquivado') return false;
    var d = String(c.data || '').slice(0, 10);
    return d >= iniMes && d <= hoje;
  });
  var mCom = 0, mVen = 0;
  bMes.forEach(function(c) { mCom += num(c.comissao); mVen += num(c.vendas); });
  var mCont = (b.conteudos || []).filter(function(c) {
    var st = normKey(c.status);
    var d = String(c.data || '').slice(0, 10);
    return d >= iniMes && d <= hoje && (st.indexOf('publicado') > -1 || st.indexOf('analise') > -1 || st.indexOf('vencedor') > -1);
  }).length;
  var metas = {
    comissao: { atual: arred2(mCom), meta: num(cfg.metaComissao) },
    vendas: { atual: mVen, meta: num(cfg.metaVendas) },
    conteudos: { atual: mCont, meta: num(cfg.metaConteudos) }
  };

  return {
    kpis: kpis, comissaoDelta: comissaoDelta,
    serieVendas: serieVendas, serieComissao: serieComissao,
    classif: classif, categorias: categorias, tops: tops, topC: topC,
    metas: metas, porProduto: porProduto, P: P, C: C,
    todosC: b.conteudos || [], listas: b.listas || {}, config: cfg,
    hoje: hoje, periodo: period
  };
}

function gerarAlertas(d) {
  var out = [];
  var regras = d.config.regras || {};
  var estagiosAtivos = ['aprovado', 'solicitado', 'aguardando', 'producao', 'publicado', 'teste', 'escalando'];
  d.P.forEach(function(p) {
    var a = d.porProduto[p.id];
    var st = normKey(p.status), cl = normKey(p.classificacao);
    if (st.indexOf('descartado') > -1 || cl.indexOf('descartado') > -1) return;
    if (!a || a.videos === 0) {
      var ativo = false;
      for (var i = 0; i < estagiosAtivos.length; i++) if (st.indexOf(estagiosAtivos[i]) > -1) { ativo = true; break; }
      if (ativo) out.push({ tipo: 'sem_conteudo', icone: '⚠️', texto: '"' + p.produto + '" está "' + p.status + '" sem nenhum conteúdo publicado.' });
    } else if (a.videos >= num(regras.videosSemVenda) && a.vendas === 0) {
      out.push({ tipo: 'baixa_taxa', icone: '⚠️', texto: '"' + p.produto + '": ' + a.videos + ' vídeos e 0 vendas. Reposicione o gancho ou o criativo.' });
    }
  });
  d.P.forEach(function(p) {
    if (normKey(p.status).indexOf('retestar') > -1) {
      out.push({ tipo: 'retest', icone: '🔁', texto: '"' + p.produto + '" está marcado para reteste.' });
    }
  });
  var ini7 = dataMenosDias(6), ini14 = dataMenosDias(13);
  var ult7 = {}, prev7 = {};
  d.todosC.forEach(function(c) {
    if (c.status === '❌ Arquivado') return;
    var cd = String(c.data || '').slice(0, 10);
    if (!cd) return;
    if (cd >= ini7 && cd <= d.hoje) ult7[c.produtoId] = (ult7[c.produtoId] || 0) + num(c.vendas);
    else if (cd >= ini14 && cd < ini7) prev7[c.produtoId] = (prev7[c.produtoId] || 0) + num(c.vendas);
  });
  var mapaP = {};
  d.P.forEach(function(p) { mapaP[p.id] = p; });
  Object.keys(ult7).forEach(function(id) {
    if (!mapaP[id]) return;
    var u = ult7[id], pr = prev7[id] || 0;
    if (u >= 2 && pr > 0) {
      var pct = Math.round((u - pr) / pr * 100);
      if (pct >= num(regras.crescimentoPct)) {
        out.push({ tipo: 'crescimento', icone: '🔥', texto: '"' + mapaP[id].produto + '" cresceu ' + pct + '% nas vendas nas últimas 7 dias.' });
      }
    }
  });
  d.P.forEach(function(p) {
    var a = d.porProduto[p.id];
    var cl = normKey(p.classificacao), st = normKey(p.status);
    if (a && a.vendas >= num(regras.vendasCampeao) && cl.indexOf('campeao') === -1 && st.indexOf('descartado') === -1) {
      out.push({ tipo: 'escala', icone: '🏆', texto: '"' + p.produto + '" já soma ' + a.vendas + ' vendas — considere escalar.' });
    }
  });
  return out.slice(0, 6);
}
function gerarInsights(d) {
  var out = [];
  var kpis = d.kpis, tops = d.tops, topC = d.topC, categorias = d.categorias;
  if (tops.length && tops[0].vendas > 0) {
    out.push({ icone: '🏆', texto: '"' + tops[0].produto + '" é o produto com mais vendas no período (' + tops[0].vendas + ' vendas, ' + fmtMoeda(tops[0].comissao) + ' de comissão).' });
  }
  if (categorias.length && kpis.vendas > 0) {
    var share = Math.round(categorias[0].comissao / (d.kpis.comissao || 1) * 100);
    if (share >= 20) out.push({ icone: '📦', texto: '"' + categorias[0].categoria + '" concentra ' + share + '% da comissão do período.' });
  }
  var ini7 = dataMenosDias(6), n7 = 0;
  d.todosC.forEach(function(c) {
    if (c.status === '❌ Arquivado') return;
    var cd = String(c.data || '').slice(0, 10);
    if (cd && cd >= ini7 && cd <= d.hoje) n7++;
  });
  if (n7 > 0) out.push({ icone: '🎬', texto: 'Foram publicados ' + n7 + ' conteúdo' + (n7 === 1 ? '' : 's') + ' nos últimos 7 dias.' });
  var semC = 0;
  d.P.forEach(function(p) {
    var a = d.porProduto[p.id];
    var st = normKey(p.status), cl = normKey(p.classificacao);
    if (cl.indexOf('descartado') > -1) return;
    if (st.indexOf('novo') > -1 || st.indexOf('analise') > -1) return;
    if (!a || a.videos === 0) semC++;
  });
  if (semC > 0) out.push({ icone: '🧪', texto: semC + ' produto' + (semC === 1 ? '' : 's') + ' em estágio avançado sem nenhum conteúdo publicado.' });
  if (topC.length && topC[0].vendas > 0) {
    out.push({ icone: '📈', texto: 'O conteúdo "' + topC[0].titulo + '" (' + topC[0].produto + ') é o melhor criativo do período, com ' + topC[0].vendas + ' vendas.' });
  }
  if (kpis.campeoes > 0) out.push({ icone: '🏆', texto: 'A esteira tem ' + kpis.campeoes + ' produto' + (kpis.campeoes === 1 ? '' : 's') + ' CAMPEÃO — priorize escala e novos criativos.' });
  if (!out.length) out.push({ icone: '💡', texto: 'Continue registrando dados para gerar insights.' });
  return out.slice(0, 5);
}

/* ============================================================
   12. RENDER — DASHBOARD
   ============================================================ */
function renderDashboard() {
  if (!state.data) return;
  var b = state.data;
  var d = calcularDashboard(b, state.period, state.dashF);

  $('#dash-sub').textContent = 'Visão geral da operação · ' +
    (state.period === 'all' ? 'todo o histórico' : 'últimos ' + state.period + ' dias');

  // hero quando vazio
  if (b.produtos.length === 0) {
    $('#dash-hero').classList.remove('hidden');
    $('#dash-hero').innerHTML = heroHtml('🎬', 'Bem-vindo à sua operação',
      'Cadastre seu primeiro produto e registre conteúdos para ver o dashboard ganhar vida.',
      '<button class="btn btn-primary" data-act="new-product">+ Cadastrar produto</button>');
    $('#dash-content').classList.add('hidden');
    return;
  }
  $('#dash-hero').classList.add('hidden');
  $('#dash-content').classList.remove('hidden');

  // ----- KPIs -----
  var k = d.kpis;
  var kpisHtml = [
    { ic: ICONS.money, cor: 'var(--accent)', glow: 'rgba(46,230,200,.10)', label: 'Comissão gerada', val: k.comissao, fmt: fmtMoeda, foot: kpiDeltaHtml(d.comissaoDelta) },
    { ic: ICONS.cart, cor: 'var(--blue)', glow: 'rgba(77,163,255,.10)', label: 'Vendas', val: k.vendas, fmt: fmtInt, foot: '<span class="kpi-note">no período</span>' },
    { ic: ICONS.play, cor: 'var(--violet)', glow: 'rgba(157,123,255,.10)', label: 'Conteúdos publicados', val: k.conteudosPublicados, fmt: fmtInt, foot: '<span class="kpi-note">em período</span>' },
    { ic: ICONS.box, cor: 'var(--green)', glow: 'rgba(61,220,151,.10)', label: 'Produtos ativos', val: k.produtosAtivos, fmt: fmtInt, foot: '<span class="kpi-note">' + k.campeoes + ' campeão' + (k.campeoes === 1 ? '' : 'es') + '</span>' },
    { ic: ICONS.eye, cor: 'var(--purple)', glow: 'rgba(197,138,255,.10)', label: 'Visualizações', val: k.visualizacoes, fmt: fmtCompact, foot: '<span class="kpi-note">views totais</span>' },
    { ic: ICONS.cursor, cor: 'var(--orange)', glow: 'rgba(255,157,92,.10)', label: 'Cliques no produto', val: k.clicks, fmt: fmtCompact, foot: kpiNoteCratio(k.clicks, k.visualizacoes, 'CR') },
    { ic: ICONS.bag, cor: 'var(--pink)', glow: 'rgba(255,122,184,.10)', label: 'Carrinhos', val: k.carrinhos, fmt: fmtInt, foot: kpiNoteCratio(k.carrinhos, k.clicks, 'CR carrinho') },
    { ic: ICONS.trophy, cor: 'var(--gold)', glow: 'rgba(244,185,66,.12)', label: 'Campeões na esteira', val: k.campeoes, fmt: fmtInt, foot: '<span class="kpi-note">classificação 🟢</span>' }
  ];
  var box = $('#dash-kpis');
  box.innerHTML = kpisHtml.map(function(x) {
    return '<div class="kpi" style="--kpi-glow:' + x.glow + '">' +
      '<div class="kpi-top"><span class="kpi-ic" style="color:' + x.cor + ';background:rgba(255,255,255,.045);border:1px solid var(--border)">' +
      '<span style="width:16px;height:16px;display:block">' + x.ic + '</span></span>' +
      '<span class="kpi-label">' + x.label + '</span></div>' +
      '<div class="kpi-value" data-v="' + x.val + '" data-fmt="' + (typeof x.fmt === 'string' ? x.fmt : '') + '">' + '0' + '</div>' +
      '<div class="kpi-foot">' + (x.foot || '') + '</div></div>';
  }).join('');
  box.querySelectorAll('.kpi-value').forEach(function(el, i) {
    var x = kpisHtml[i];
    countUp(el, x.val, x.fmt);
  });

  // ----- metas -----
  function metaHtml(label, m, fmt) {
    var pct = m.meta > 0 ? Math.min(100, (m.atual / m.meta) * 100) : 0;
    var cls = pct >= 100 ? 'ok' : (pct >= 60 ? 'mid' : 'low');
    return '<div class="meta"><div class="meta-top"><span class="meta-label">' + label + ' (mês)</span>' +
      '<span class="meta-nums">' + fmt(m.atual) + ' / ' + fmt(m.meta) + '</span></div>' +
      '<div class="meta-bar"><div class="meta-fill ' + cls + '" data-w="' + pct.toFixed(1) + '"></div></div></div>';
  }
  var ms = $('#dash-metas');
  ms.innerHTML = metaHtml('Meta de comissão', d.metas.comissao, fmtMoeda) +
    metaHtml('Meta de vendas', d.metas.vendas, fmtInt) +
    metaHtml('Meta de conteúdos', d.metas.conteudos, fmtInt);
  requestAnimationFrame(function() {
    ms.querySelectorAll('.meta-fill').forEach(function(f) { f.style.width = f.getAttribute('data-w') + '%'; });
  });

  // ----- gráficos -----
  lineChart($('#chart-sales'), d.serieVendas, { sufixo: 'vendas' });
  lineChart($('#chart-comissao'), d.serieComissao, { cor: '#f4b942', gold: true, moeda: true });
  $('#tag-sales').textContent = d.serieVendas.length > 12 ? 'diário (' + d.serieVendas.length + 'd)' : 'por dia de venda';
  $('#tag-comissao').textContent = d.serieComissao.length > 12 ? 'diário (' + d.serieComissao.length + 'd)' : 'por dia de venda';

  // ----- vendas diretas no período + comissão por origem -----
  var vd = resumoVendasDiretas_(state.period);
  if (!vd.lista.length) {
    $('#dash-vendas-diretas').innerHTML = '<div class="list-empty-big" style="padding:24px 10px">Nenhuma venda direta registrada no período.<br>Use a aba <b>Vendas</b> para lançar em segundos. ⚡</div>';
  } else {
    $('#dash-vendas-diretas').innerHTML =
      '<div class="vd-stats">' +
        '<div class="vd-stat"><span>Unidades</span><b>' + fmtInt(vd.un) + '</b></div>' +
        '<div class="vd-stat"><span>Faturamento</span><b>' + fmtMoeda(vd.rec) + '</b></div>' +
        '<div class="vd-stat"><span>Comissão</span><b style="color:var(--aqua)">' + fmtMoeda(vd.com) + '</b></div>' +
      '</div><div id="dash-vd-bars"></div>';
    bars($('#dash-vd-bars'), vd.porProduto, { moeda: true, grads: ['', 'gold', 'blue', 'violet'] });
  }
  bars($('#chart-origem'), [
    { nome: '🎬 Via conteúdos', v: d.kpis.comissao, sub: fmtInt(d.kpis.vendas) + ' vendas' },
    { nome: '🛒 Vendas diretas', v: vd.com, sub: fmtInt(vd.un) + ' unidades', cls: 'gold' }
  ], { moeda: true });

  var COR_CL = ['#f4b942', '#25F4EE', '#ffd166', '#ff9d5c', '#ff5d6c', '#67718a', '#3a4157'];
  donut($('#chart-classif'), d.classif.map(function(c, i) {
    return { label: c.key, total: c.total, cor: COR_CL[i % COR_CL.length] };
  }));

  bars($('#chart-categorias'), d.categorias.map(function(c) {
    return { nome: c.categoria, v: c.comissao, sub: c.vendas + ' vendas · ' + c.videos + ' vídeos' };
  }), { moeda: true, grads: GRADS });

  // ----- tops -----
  $('#top-produtos').innerHTML = d.tops.length ? d.tops.map(function(t, i) {
    return '<div class="rk-row">' +
      '<div class="rk-pos">' + (i + 1) + '</div>' +
      '<div class="rk-main"><div class="rk-title">' + esc(t.produto) + '</div>' +
      '<div class="rk-sub">' + badgeClassif(t.classificacao) + ' <span>' + esc(t.categoria) + '</span></div>' +
      '<div class="rk-perf"><i style="width:' + t.perf + '%"></i></div></div>' +
      '<div class="rk-right"><div class="rk-num">' + t.vendas + '</div><div class="rk-lbl">vendas</div></div></div>';
  }).join('') : emptyHtml('Nenhuma venda no período ainda.');

  $('#top-conteudos').innerHTML = d.topC.length ? d.topC.map(function(t, i) {
    return '<div class="rk-row">' +
      '<div class="rk-pos">' + (i + 1) + '</div>' +
      '<div class="rk-main"><div class="rk-title">' + esc(t.titulo) + '</div>' +
      '<div class="rk-sub">' + esc(t.produto) + ' · ' + esc(t.tipo) + '</div>' +
      '<div class="rk-perf"><i style="width:' + t.perf + '%"></i></div></div>' +
      '<div class="rk-right"><div class="rk-num">' + t.vendas + '</div><div class="rk-lbl">vendas</div></div></div>';
  }).join('') : emptyHtml('Sem conteúdos com métricas no período.');

  // ----- alertas / insights -----
  var alerts = gerarAlertas(d);
  $('#dash-alerts').innerHTML = alerts.length ? alerts.map(function(a) {
    return '<div class="attn-item ' + (a.tipo === 'escala' ? 'win' : a.tipo === 'crescimento' ? 'grow' : a.tipo === 'baixa_taxa' ? 'heat' : '') + '">' +
      '<span class="attn-ic">' + a.icone + '</span><span class="attn-txt">' + esc(a.texto) + '</span></div>';
  }).join('') : '<div class="list-empty-big" style="padding:26px 10px">Tudo em dia por aqui. 🎉</div>';
  var insights = gerarInsights(d);
  if (vd.un > 0) insights.unshift({ icone: '🛒', texto: 'Vendas diretas: ' + fmtInt(vd.un) + ' unidade(s) no período — ' + fmtMoeda(vd.com) + ' de comissão além dos conteúdos.' });
  $('#dash-insights').innerHTML = insights.map(function(a) {
    return '<div class="ins-item"><span class="ins-ic">' + a.icone + '</span><span class="ins-txt">' + esc(a.texto) + '</span></div>';
  }).join('');
}
function kpiDeltaHtml(delta) {
  if (delta === null || delta === undefined) return '<span class="kpi-note">vs. período anterior</span>';
  if (delta > 0) return '<span class="kpi-delta up">▲ +' + delta + '%</span><span class="kpi-note">vs. anterior</span>';
  if (delta < 0) return '<span class="kpi-delta down">▼ ' + delta + '%</span><span class="kpi-note">vs. anterior</span>';
  return '<span class="kpi-delta flat">— 0%</span><span class="kpi-note">vs. anterior</span>';
}
function kpiNoteCratio(a, b, nome) {
  if (!b) return '<span class="kpi-note">—</span>';
  return '<span class="kpi-note">' + nome + ' ' + ((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%</span>';
}

/* ============================================================
   13. RENDER — ESTEIRA (tabela + kanban DnD)
   ============================================================ */
function produtosFiltradosEsteira() {
  var f = state.esteira.f;
  var q = normKey(f.q);
  return (state.data.produtos || []).filter(function(p) {
    if (f.status && p.status !== f.status) return false;
    if (f.classif && p.classificacao !== f.classif) return false;
    if (f.cat && p.categoria !== f.cat) return false;
    if (f.prio && p.prioridade !== f.prio) return false;
    if (q) {
      var alvo = normKey(p.produto + ' ' + p.categoria + ' ' + p.status + ' ' + p.classificacao + ' ' + p.id);
      if (alvo.indexOf(q) === -1) return false;
    }
    return true;
  });
}
function renderEsteira() {
  if (!state.data) return;
  var modo = state.esteira.modo;
  var lista = produtosFiltradosEsteira();
  lancMap_ = lancadosPorProduto_();
  var nAtivos = (state.data.produtos || []).filter(function(p) {
    return normKey(p.classificacao).indexOf('descartado') === -1;
  }).length;
  $('#esteira-sub').textContent = nAtivos + ' produto' + (nAtivos === 1 ? '' : 's') + ' na esteira';

  $('#esteira-table').classList.toggle('hidden', modo !== 'tabela');
  $('#esteira-kanban').style.display = modo === 'kanban' ? 'grid' : 'none';
  $('#esteira-empty').classList.toggle('hidden', lista.length > 0);
  if (!lista.length) {
    $('#esteira-empty').innerHTML = heroHtml('🎯', 'Nenhum produto encontrado',
      'Ajuste os filtros ou cadastre um novo produto para começar a mover a esteira.',
      '<button class="btn btn-primary" data-act="new-product">+ Novo produto</button>');
  }

  if (modo === 'tabela') {
    $('#esteira-tbody').innerHTML = lista.map(function(p) {
      var lm = lancMap_[p.id] || { total: num(p.videos), lanc: num(p.videos) };
      return '<tr data-id="' + esc(p.id) + '">' +
        '<td><div class="td-strong">' + esc(p.produto) + '</div><div class="td-sub">' + esc(p.id) + '</div></td>' +
        '<td>' + esc(p.categoria) + '</td>' +
        '<td class="num">' + fmtMoeda(p.preco) + '</td>' +
        '<td class="num">' + num(p.comissaoPct).toLocaleString('pt-BR') + '% <span class="td-sub">(' + fmtMoeda(p.comissaoVenda) + '/venda)</span></td>' +
        '<td>' + badgeStatus(p.status) + '</td>' +
        '<td>' + badgeClassif(p.classificacao) + '</td>' +
        '<td class="num" title="' + lm.lanc + ' vídeo(s) lançados · ' + lm.total + ' registrado(s)"><b>' + lm.lanc + '</b>' +
          (lm.total !== lm.lanc ? ' <span class="td-sub">/ ' + lm.total + '</span>' : '') + '</td>' +
        '<td class="num"><b>' + p.vendas + '</b></td>' +
        '<td class="num"><b>' + fmtMoeda(p.comissaoTotal) + '</b></td>' +
        '<td class="td-actions">' +
          '<button class="icon-btn" data-act="edit-product" data-id="' + esc(p.id) + '" title="Editar">' + ICONS.edit + '</button>' +
          '<button class="icon-btn" data-act="archive-product" data-id="' + esc(p.id) + '" title="Arquivar">' + ICONS.trash + '</button>' +
        '</td></tr>';
    }).join('');
  } else {
    renderKanban_(lista);
  }
}
function cardKanbanHtml(p) {
  var col = colunaDe(p);
  var champ = col === 'campeoes';
  var lm = lancMap_[p.id] || { total: num(p.videos), lanc: num(p.videos) };
  return '<div class="kcard' + (champ ? ' champ' : '') + '" draggable="true" data-id="' + esc(p.id) + '">' +
    '<div class="kcard-title">' + esc(p.produto) + '</div>' +
    '<div class="kcard-cat">' + esc(p.categoria) + ' · ' + esc(p.id) + '</div>' +
    '<div class="kcard-foot">' +
      (champ ? '<span class="badge b-gold-strong"><span class="bdot"></span>🏆 Campeão</span>' : badgeStatus(p.status)) +
      '<span class="kcard-metric" title="' + lm.lanc + ' vídeo(s) lançados · ' + lm.total + ' conteúdo(s) registrados">🚀 <b>' + lm.lanc + '</b></span>' +
      '<span class="kcard-metric">🛒 <b>' + p.vendas + '</b></span>' +
      (p.comissaoTotal > 0 ? '<span class="kcard-metric money">💰 <b>' + fmtMoeda(p.comissaoTotal) + '</b></span>' : '') +
    '</div></div>';
}
function renderKanban_(lista) {
  var kb = $('#esteira-kanban');
  kb.innerHTML = KANBAN_COLS.map(function(c) {
    var items = lista.filter(function(p) { return colunaDe(p) === c.key; });
    return '<div class="kcol" data-col="' + c.key + '" style="--col-c:' + c.cor + '">' +
      '<div class="kcol-head"><span class="kcol-name">' + c.rotulo + '</span>' +
      '<span class="kcol-count">' + items.length + '</span></div>' +
      '<div class="kcol-body">' +
      (items.length ? items.map(cardKanbanHtml).join('') : '<div class="kcol-empty">Sem produtos</div>') +
      '</div></div>';
  }).join('');
  bindKanbanDnd_(kb);
}
var dragId_ = null;
function bindKanbanDnd_(kb) {
  kb.querySelectorAll('.kcard').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      dragId_ = card.getAttribute('data-id');
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragId_); } catch (err) {}
    });
    card.addEventListener('dragend', function() {
      card.classList.remove('dragging');
      $$('.kcol.over').forEach(function(z) { z.classList.remove('over'); });
    });
    card.addEventListener('click', function() {
      var id = card.getAttribute('data-id');
      var p = (state.data.produtos || []).filter(function(x) { return x.id === id; })[0];
      if (p) openProdutoModal(p);
    });
  });
  kb.querySelectorAll('.kcol').forEach(function(zone) {
    zone.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', function(e) {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('over');
    });
    zone.addEventListener('drop', function(e) {
      e.preventDefault();
      zone.classList.remove('over');
      var col = zone.getAttribute('data-col');
      var id = dragId_ || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      dragId_ = null;
      if (!id) return;
      var p = (state.data.produtos || []).filter(function(x) { return x.id === id; })[0];
      if (!p) return;
      var de = colunaDe(p);
      if (de === col) return;
      var destino = KANBAN_COLS.filter(function(c) { return c.key === col; })[0];
      var msg = 'Mover <b>"' + esc(p.produto) + '"</b> para a coluna <b>' + esc(destino.rotulo) + '</b>?' +
        (col === 'descartados' ? '<br><small style="color:var(--text-3)">O produto será marcado como Descartado (nada é apagado).</small>' : '');
      confirmar(msg, 'Mover', function() {
        API.rpc('move_product_column', { p_id: id, p_coluna: col }).then(function(r) {
          if (!r.ok) throw new Error(r.message);
          toast(r.message, 'success');
          if (col === 'campeoes' && de !== 'campeoes') {
            carregarTudo_(true).then(function() {
              var card = $$('.kcard').filter(function(x) { return x.getAttribute('data-id') === id; })[0];
              if (card) { card.classList.add('burst'); setTimeout(function() { card.classList.remove('burst'); }, 1000); }
            });
          } else {
            carregarTudo_(true);
          }
        }).catch(function(e) { toast(e.message, 'error'); });
      }, col === 'descartados');
    });
  });
}

/* ============================================================
   14. RENDER — CADASTROS
   ============================================================ */
function renderCadastro() {
  if (!state.data) return;
  var f = state.cadastro.f;
  var q = normKey(f.q);
  var lista = (state.data.produtos || []).filter(function(p) {
    if (f.cat && p.categoria !== f.cat) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.prio && p.prioridade !== f.prio) return false;
    if (q) {
      var alvo = normKey(p.produto + ' ' + p.categoria + ' ' + p.id + ' ' + p.status);
      if (alvo.indexOf(q) === -1) return false;
    }
    return true;
  });
  $('#cadastro-count').textContent = lista.length + ' de ' + state.data.produtos.length + ' produto(s)';
  if (!state.data.produtos.length) {
    $('#cadastro-hero').classList.remove('hidden');
    $('#cadastro-hero').innerHTML = heroHtml('📦', 'Nenhum produto cadastrado',
      'Cadastre o primeiro produto da sua operação TikTok Shop. A comissão por venda é calculada automaticamente a partir do preço e da porcentagem.',
      '<button class="btn btn-primary" data-act="new-product">+ Cadastrar produto</button>');
    $('#cadastro-content').classList.add('hidden');
    return;
  }
  $('#cadastro-hero').classList.add('hidden');
  $('#cadastro-content').classList.remove('hidden');
  if (!lista.length) {
    $('#cadastro-tbody').innerHTML = '<tr><td colspan="12"><div class="list-empty">Nenhum produto com esses filtros.</div></td></tr>';
    return;
  }
  $('#cadastro-tbody').innerHTML = lista.map(function(p) {
    return '<tr data-id="' + esc(p.id) + '">' +
      '<td><div class="td-strong">' + esc(p.produto) + '</div><div class="td-sub">' + esc(p.id) + ' · ' + esc(p.loja || 'sem loja') + '</div></td>' +
      '<td>' + esc(p.categoria) + '</td>' +
      '<td class="num">' + fmtMoeda(p.preco) + '</td>' +
      '<td class="num">' + num(p.comissaoPct).toLocaleString('pt-BR') + '%</td>' +
      '<td>' + prioBadge(p.prioridade) + '</td>' +
      '<td>' + badgeStatus(p.status) + '</td>' +
      '<td>' + badgeClassif(p.classificacao) + '</td>' +
      '<td class="num">' + p.videos + '</td>' +
      '<td class="num"><b>' + p.vendas + '</b></td>' +
      '<td class="num"><b>' + fmtMoeda(p.comissaoTotal) + '</b></td>' +
      '<td><span class="td-sub">' + fmtData(p.dataCadastro) + '</span></td>' +
      '<td class="td-actions">' +
        '<button class="icon-btn" data-act="edit-product" data-id="' + esc(p.id) + '" title="Editar">' + ICONS.edit + '</button>' +
        '<button class="icon-btn" data-act="archive-product" data-id="' + esc(p.id) + '" title="Arquivar">' + ICONS.trash + '</button>' +
      '</td></tr>';
  }).join('');
}

/* ============================================================
   15. RENDER — CONTEÚDOS
   ============================================================ */
/* Faixa "vídeos por produto" no topo da aba Conteúdos — clique filtra a tabela */
function renderPorProdutoStrip_() {
  var box = $('#conteudos-porproduto');
  if (!box) return;
  var m = lancadosPorProduto_();
  var ativos = (state.data.produtos || []).filter(function(p) {
    return m[p.id] && m[p.id].total > 0 && normKey(p.classificacao).indexOf('descartado') === -1;
  });
  if (!ativos.length) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  ativos.sort(function(a, b) { return m[b.id].lanc - m[a.id].lanc; });
  box.innerHTML = '<span class="pp-label">🚀 Vídeos lançados por produto:</span>' + ativos.map(function(p) {
    var e = m[p.id];
    return '<button class="pp-chip' + (state.conteudos.f.produto === p.id ? ' active' : '') + '" data-pid="' + esc(p.id) + '" ' +
      'title="' + e.lanc + ' lançado(s) · ' + e.total + ' conteúdo(s) registrado(s)">' + esc(p.produto) + ' <b>' + e.lanc + '</b></button>';
  }).join('');
  box.classList.remove('hidden');
}
function renderConteudos() {
  if (!state.data) return;
  renderPorProdutoStrip_();
  var f = state.conteudos.f;
  var q = normKey(f.q);
  var inicio = f.period ? dataMenosDias(parseInt(f.period, 10) - 1) : null;
  var pMapa = {};
  (state.data.produtos || []).forEach(function(p) { pMapa[p.id] = p; });
  var lista = (state.data.conteudos || []).filter(function(c) {
    if (f.produto && c.produtoId !== f.produto) return false;
    if (f.cat && c.categoria !== f.cat) return false;
    if (f.status && c.status !== f.status) return false;
    if (f.tipo && c.tipo !== f.tipo) return false;
    if (inicio) {
      var d = String(c.data || '').slice(0, 10);
      if (!d || d < inicio) return false;
    }
    if (q) {
      var alvo = normKey(c.titulo + ' ' + c.produto + ' ' + c.tipo + ' ' + c.gancho + ' ' + c.id);
      if (alvo.indexOf(q) === -1) return false;
    }
    return true;
  });
  var sk = state.conteudos.sort;
  lista.sort(function(a, b) {
    var va = sk.key === 'data' ? String(a.data) : num(a[sk.key]);
    var vb = sk.key === 'data' ? String(b.data) : num(b[sk.key]);
    var cmp = va < vb ? -1 : (va > vb ? 1 : 0);
    return cmp * sk.dir; // dir -1 = descendente
  });
  $('#conteudos-count').textContent = lista.length + ' de ' + state.data.conteudos.length + ' conteúdo(s)';
  if (!state.data.conteudos.length) {
    $('#conteudos-hero').classList.remove('hidden');
    $('#conteudos-hero').innerHTML = heroHtml('🎬', 'Nenhum conteúdo registrado',
      'Registre cada vídeo publicado: views, cliques, carrinhos, vendas. A comissão gerada é calculada automaticamente pela comissão do produto.',
      '<button class="btn btn-primary" data-act="new-content">+ Registrar conteúdo</button>');
    $('#conteudos-content').classList.add('hidden');
    renderPerfilTikTok();
    renderVideoGallery();
    return;
  }
  $('#conteudos-hero').classList.add('hidden');
  $('#conteudos-content').classList.remove('hidden');
  $$('#conteudos-table thead th[data-sort]').forEach(function(th) {
    th.classList.toggle('sorted', th.getAttribute('data-sort') === sk.key);
    var ar = th.querySelector('.th-arrow');
    if (ar) ar.textContent = th.getAttribute('data-sort') === sk.key ? (sk.dir === -1 ? '↓' : '↑') : '';
  });
  if (!lista.length) {
    $('#conteudos-tbody').innerHTML = '<tr><td colspan="11"><div class="list-empty">Nenhum conteúdo com esses filtros.</div></td></tr>';
    return;
  }
  $('#conteudos-tbody').innerHTML = lista.map(function(c) {
    return '<tr data-id="' + esc(c.id) + '">' +
      '<td><span class="td-sub">' + fmtData(c.data) + '</span></td>' +
      '<td><div class="td-strong">' + esc(c.produto) + '</div><div class="td-sub">' + esc(c.id) + '</div></td>' +
      '<td><div class="td-strong" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(c.titulo) + '</div>' +
        (c.url ? '<span class="td-sub">' + esc(String(c.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 34)) + (String(c.url).length > 54 ? '…' : '') + '</span>' : '') + '</td>' +
      '<td>' + esc(c.tipo) + '</td>' +
      '<td>' + esc(c.gancho) + '</td>' +
      '<td>' + badgeStatus(c.status) + '</td>' +
      '<td class="num">' + fmtCompact(c.views) + '</td>' +
      '<td class="num">' + fmtCompact(c.clicks) + '</td>' +
      '<td class="num"><b>' + c.vendas + '</b></td>' +
      '<td class="num"><b>' + fmtMoeda(c.comissao) + '</b></td>' +
      '<td class="td-actions">' +
        (tiktokVideoId(c.url)
          ? '<button class="icon-btn play" data-act="play-video" data-id="' + esc(c.id) + '" title="▶ Assistir aqui">' + ICONS.play + '</button>'
          : (c.url ? '<a class="icon-btn" href="' + esc(c.url) + '" target="_blank" rel="noopener" title="Abrir link ↗">' + ICONS.link + '</a>' : '')) +
        '<button class="icon-btn" data-act="edit-content" data-id="' + esc(c.id) + '" title="Editar">' + ICONS.edit + '</button>' +
        '<button class="icon-btn" data-act="archive-content" data-id="' + esc(c.id) + '" title="Arquivar">' + ICONS.trash + '</button>' +
      '</td></tr>';
  }).join('');
  renderPerfilTikTok();
  renderVideoGallery();
}

/* ============================================================
   16. RENDER — RELATÓRIOS
   ============================================================ */
function renderRelatorios() {
  if (!state.data) return;
  var b = state.data;
  var period = $('#rf-period').value;
  var pi = periodoInfo(period);
  var C = (b.conteudos || []).filter(function(c) {
    if (c.status === '❌ Arquivado') return false;
    var d = String(c.data || '').slice(0, 10);
    if (!d) return false;
    if (pi.inicio && d < pi.inicio) return false;
    return true;
  });
  var q = { comissao: 0, vendas: 0, views: 0, clicks: 0 };
  C.forEach(function(c) {
    q.comissao += num(c.comissao); q.vendas += num(c.vendas);
    q.views += num(c.views); q.clicks += num(c.clicks);
  });
  q.comissao = arred2(q.comissao);
  var cart = C.length ? (q.vendas / C.length) : 0;
  var cards = [
    { ic: '💰', label: 'Comissão gerada', val: fmtMoeda(q.comissao) },
    { ic: '🛒', label: 'Vendas', val: fmtInt(q.vendas) },
    { ic: '🎬', label: 'Conteúdos no período', val: fmtInt(C.length) },
    { ic: '📈', label: 'Ticket de vendas', val: C.length ? fmtMoeda(q.comissao / Math.max(1, q.vendas)) : '—' }
  ];
  $('#rep-resumo').innerHTML = cards.map(function(x) {
    return '<div class="kpi"><div class="kpi-top"><span class="kpi-ic" style="background:rgba(255,255,255,.045);border:1px solid var(--border);width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px">' + x.ic + '</span>' +
      '<span class="kpi-label">' + x.label + '</span></div><div class="kpi-value" style="font-size:20px">' + x.val + '</div></div>';
  }).join('');

  var pMapa = {};
  (b.produtos || []).forEach(function(p) { pMapa[p.id] = p; });
  var catMap = {};
  C.forEach(function(c) {
    var cat = (pMapa[c.produtoId] || {}).categoria || 'Outro';
    catMap[cat] = catMap[cat] || { videos: 0, vendas: 0, comissao: 0, views: 0, clicks: 0 };
    catMap[cat].videos++; catMap[cat].vendas += num(c.vendas);
    catMap[cat].comissao += num(c.comissao); catMap[cat].views += num(c.views); catMap[cat].clicks += num(c.clicks);
  });
  var rows = Object.keys(catMap).map(function(k) {
    var c = catMap[k];
    var cr = c.views ? ((c.clicks / c.views) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—';
    return '<tr><td class="td-strong">' + esc(k) + '</td><td class="num">' + c.videos + '</td><td class="num">' + fmtCompact(c.views) + '</td>' +
      '<td class="num">' + cr + '</td><td class="num"><b>' + c.vendas + '</b></td><td class="num"><b>' + fmtMoeda(c.comissao) + '</b></td></tr>';
  }).sort().join('');
  $('#rep-categoria').innerHTML =
    '<table class="table"><thead><tr><th>Categoria</th><th class="num">Vídeos</th><th class="num">Views</th><th class="num">CR</th><th class="num">Vendas</th><th class="num">Comissão</th></tr></thead>' +
    '<tbody>' + (rows || '<tr><td colspan="6"><div class="list-empty">Sem dados no período.</div></td></tr>') + '</tbody></table>';

  var gMap = {};
  C.forEach(function(c) {
    gMap[c.gancho] = gMap[c.gancho] || { vendas: 0, comissao: 0, videos: 0 };
    gMap[c.gancho].vendas += num(c.vendas); gMap[c.gancho].comissao += num(c.comissao); gMap[c.gancho].videos++;
  });
  var ganchos = Object.keys(gMap).map(function(k) {
    return { nome: k, v: arred2(gMap[k].comissao), sub: gMap[k].videos + ' vídeos · ' + gMap[k].vendas + ' vendas' };
  }).sort(function(a, z) { return z.v - a.v; }).slice(0, 6);
  bars($('#rep-ganchos'), ganchos, { moeda: true, grads: ['gold', '', 'blue', 'violet'] });
}

/* ============================================================
   17. RENDER — CONFIGURAÇÃO
   ============================================================ */
/* ============================================================
   Editor de listas da ferramenta (aba Configuração)
   ============================================================ */
var LISTAS_CFG = [
  { chave: 'categorias', rotulo: 'Categorias de produto', dica: 'menu "Categoria" nos produtos' },
  { chave: 'prioridades', rotulo: 'Prioridades', dica: 'menu "Prioridade" nos produtos' },
  { chave: 'ganchos', rotulo: 'Ganchos', dica: 'menu "Gancho" em produtos e conteúdos' },
  { chave: 'status_produto', rotulo: 'Status do produto', dica: 'funil da Esteira e menu "Status"' },
  { chave: 'classificacoes', rotulo: 'Classificações', dica: 'menu "Classificação" (🟢 CAMPEÃO, 🔵 PROMISSOR…)' },
  { chave: 'tipos_conteudo', rotulo: 'Tipos de conteúdo', dica: 'menu "Tipo" nos conteúdos' },
  { chave: 'status_conteudo', rotulo: 'Status do conteúdo', dica: 'menu "Status" nos conteúdos' }
];
function renderListasConfig_() {
  var box = $('#cfg-listas');
  if (!box) return;
  var L = state.data.listas || {};
  box.innerHTML = LISTAS_CFG.map(function(l) {
    var itens = L[l.chave] || [];
    return '<div class="lista-ed" data-chave="' + l.chave + '">' +
      '<div class="lista-ed-head"><b>' + l.rotulo + '</b><span>' + itens.length + ' ite' + (itens.length === 1 ? 'm' : 'ns') + ' · usado no ' + l.dica + '</span></div>' +
      '<div class="lista-ed-itens">' + itens.map(function(it, i) {
        return '<div class="lista-item">' +
          '<input class="input" type="text" maxlength="60" value="' + esc(it) + '">' +
          '<button class="icon-btn" data-del title="Remover este item">' + ICONS.trash + '</button>' +
        '</div>';
      }).join('') + '</div>' +
      '<button class="btn btn-ghost sm" data-add>➕ Adicionar item</button>' +
    '</div>';
  }).join('');
}
function salvarListas_() {
  var payload = {};
  var erro = '';
  LISTAS_CFG.forEach(function(l) {
    var inputs = $$('#cfg-listas .lista-ed[data-chave="' + l.chave + '"] .lista-item input');
    var vistos = {};
    var arr = [];
    inputs.forEach(function(inp) {
      inp.classList.remove('err');
      var v = inp.value.trim();
      if (!v) return;
      var k = normKey(v);
      if (vistos[k]) {
        if (!erro) erro = 'Item duplicado em "' + l.rotulo + '": "' + v + '".';
        inp.classList.add('err');
        return;
      }
      vistos[k] = true;
      arr.push(v);
    });
    if (!arr.length && !erro) erro = 'A lista "' + l.rotulo + '" precisa de pelo menos 1 item.';
    payload[l.chave] = arr;
  });
  if (erro) { toast(erro, 'error'); return; }
  API.rpc('save_listas', payload).then(function(r) {
    if (!r.ok) throw new Error(r.message);
    toast(r.message, 'success');
    carregarTudo_(false);
  }).catch(function(e) { toast(e.message, 'error'); });
}

function renderConfig() {
  if (!state.data) return;
  var c = state.data.config || {};
  var r = c.regras || {};
  $('#cfg-nomeOperacao').value = c.nomeOperacao || '';
  $('#cfg-nomeUsuario').value = c.nomeUsuario || '';
  $('#cfg-urlWebApp').value = c.urlWebApp || '';
  $('#cfg-metaComissao').value = c.metaComissao !== undefined ? c.metaComissao : '';
  $('#cfg-metaVendas').value = c.metaVendas !== undefined ? c.metaVendas : '';
  $('#cfg-metaConteudos').value = c.metaConteudos !== undefined ? c.metaConteudos : '';
  $('#cfg-regraVideosSemVenda').value = r.videosSemVenda !== undefined ? r.videosSemVenda : '';
  $('#cfg-regraVendasPromissor').value = r.vendasPromissor !== undefined ? r.vendasPromissor : '';
  $('#cfg-regraVendasCampeao').value = r.vendasCampeao !== undefined ? r.vendasCampeao : '';
  $('#cfg-regraCrescimentoPct').value = r.crescimentoPct !== undefined ? r.crescimentoPct : '';
  var pf = ExtraStore.load().perfil || {};
  $('#cfg-ttUser').value = pf.user || '';
  $('#cfg-ttUrl').value = pf.url || '';
  $('#cfg-ttSeguidores').value = pf.seguidores !== undefined && pf.seguidores !== null ? String(pf.seguidores) : '';
  renderListasConfig_();
  renderLogs_(state.data.logs || []);
}
function salvarPerfilTikTok_() {
  var user = $('#cfg-ttUser').value.trim();
  var url = $('#cfg-ttUrl').value.trim();
  var seg = Math.round(parseDec($('#cfg-ttSeguidores').value));
  if (!user && !url) { toast('Informe o usuário (@) ou o link do perfil.', 'warn'); return; }
  var h = ttHandleLimpo(user || url);
  if (url && !/^https?:\/\//i.test(url)) { toast('O link do perfil deve começar com https://', 'error'); return; }
  var ex = ExtraStore.load();
  ex.perfil = { user: user, url: url, seguidores: seg || null, handle: h };
  ExtraStore.save();
  toast('Perfil do TikTok salvo! Ele aparece na aba Conteúdos. 🎬', 'success');
}
function renderLogs_(logs) {
  var box = $('#logs-box');
  if (!logs.length) { box.innerHTML = '<div class="list-empty" style="padding:18px 4px">Nenhuma ação registrada ainda.</div>'; return; }
  box.innerHTML = logs.map(function(l) {
    return '<div class="log-row"><span class="log-time">' + esc(fmtDataHora(l.data)) + '</span>' +
      '<span class="log-acao ' + esc(l.acao) + '">' + esc(l.acao) + '</span>' +
      '<span class="log-desc">' + esc(l.descricao) + '</span></div>';
  }).join('');
}
function salvarConfig_() {
  var payload = {
    nomeOperacao: $('#cfg-nomeOperacao').value.trim(),
    nomeUsuario: $('#cfg-nomeUsuario').value.trim(),
    urlWebApp: $('#cfg-urlWebApp').value.trim(),
    metaComissao: parseDec($('#cfg-metaComissao').value),
    metaVendas: Math.round(parseDec($('#cfg-metaVendas').value)),
    metaConteudos: Math.round(parseDec($('#cfg-metaConteudos').value)),
    regraVideosSemVenda: Math.round(parseDec($('#cfg-regraVideosSemVenda').value)),
    regraVendasPromissor: Math.round(parseDec($('#cfg-regraVendasPromissor').value)),
    regraVendasCampeao: Math.round(parseDec($('#cfg-regraVendasCampeao').value)),
    regraCrescimentoPct: Math.round(parseDec($('#cfg-regraCrescimentoPct').value))
  };
  API.rpc('save_config', payload).then(function(r) {
    if (!r.ok) throw new Error(r.message);
    state.data.config = r.config;
    toast(r.message, 'success');
    renderDashboard();
  }).catch(function(e) { toast(e.message, 'error'); });
}
function rodarDiagnostico_() {
  $('#diag-box').innerHTML = '<div class="diag-row"><span class="dico" style="color:var(--gold)">…</span><span>Executando diagnóstico…</span></div>';
  API.rpc('diagnostico_sistema').then(function(r) {
    var cls = r.status === 'SISTEMA OK' ? 'ok' : 'bad';
    var html = '<div class="diag-status ' + cls + '">' + (r.status === 'SISTEMA OK' ? '✓ ' : '✗ ') + esc(r.status) + '</div>';
    (r.linhas || []).forEach(function(l) {
      html += '<div class="diag-row ' + (l.ok ? 'ok' : 'bad') + '"><span class="dico">' + (l.ok ? '✓' : '✗') + '</span><span>' + esc(l.texto) + '</span></div>';
    });
    $('#diag-box').innerHTML = html;
    toast(r.status, r.status === 'SISTEMA OK' ? 'success' : 'warn');
    return carregarTudo_(false);
  }).catch(function(e) {
    $('#diag-box').innerHTML = '<div class="diag-row bad"><span class="dico">✗</span><span>' + esc(e.message) + '</span></div>';
  });
}

/* ============================================================
   18. MODAL — PRODUTO
   ============================================================ */
function opcoesSelect_(el, itens, placeholder, valor) {
  el.innerHTML = (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
    itens.map(function(i) { return '<option value="' + esc(i) + '"' + (i === valor ? ' selected' : '') + '>' + esc(i) + '</option>'; }).join('');
}
function openProdutoModal(p) {
  p = p || { novo: true };
  var listas = state.data.listas || {};
  var temVideos = p.id ? videosDoProduto(p.id).length : 0;
  var foot =
    (p.id && temVideos ? '<button class="btn btn-ghost btn-gallery" id="pm-gallery">🎬 Ver ' + temVideos + ' vídeo' + (temVideos > 1 ? 's' : '') + '</button>' : '') +
    '<button class="btn btn-ghost" data-close>Cancelar</button>' +
    '<button class="btn btn-primary" id="pm-save">' + (p.id ? 'Salvar alterações' : 'Cadastrar produto') + '</button>';
  openModal(
    '<div class="form-grid">' +
    '<div class="field full" id="fld-produto"><label>Nome do produto <i class="req">*</i></label>' +
      '<input class="input" id="pm-produto" type="text" value="' + esc(p.produto || '') + '" placeholder="Ex.: Mini projetor portátil"><span class="ferr"></span></div>' +
    '<div class="field" id="fld-categoria"><label>Categoria <i class="req">*</i></label>' +
      '<select class="select" id="pm-categoria"></select><span class="ferr"></span></div>' +
    '<div class="field" id="fld-preco"><label>Preço (R$) <i class="req">*</i></label>' +
      '<input class="input" id="pm-preco" type="text" inputmode="decimal" value="' + esc(p.preco !== undefined ? p.preco : '') + '" placeholder="99,90"><span class="ferr"></span></div>' +
    '<div class="field" id="fld-comissaoPct"><label>Comissão (%) <i class="req">*</i></label>' +
      '<input class="input" id="pm-pct" type="text" inputmode="decimal" value="' + esc(p.comissaoPct !== undefined ? p.comissaoPct : '') + '" placeholder="15"><span class="ferr"></span>' +
      '<span class="fhint" id="pm-cvhint"></span></div>' +
    '<div class="field"><label>Prioridade</label><select class="select" id="pm-prioridade"></select></div>' +
    '<div class="field"><label>Tipo de gancho</label><select class="select" id="pm-gancho"></select></div>' +
    '<div class="field"><label>Status</label><select class="select" id="pm-status"></select></div>' +
    '<div class="field"><label>Classificação</label><select class="select" id="pm-classif"></select></div>' +
    '<div class="field full"><label>Link do produto</label><input class="input" id="pm-link" type="text" value="' + esc(p.link || '') + '" placeholder="https://…"></div>' +
    '<div class="field"><label>Loja / vendedor</label><input class="input" id="pm-loja" type="text" value="' + esc(p.loja || '') + '"></div>' +
    '<div class="field"><label>Observações</label><input class="input" id="pm-obs" type="text" value="' + esc(p.obs || '') + '"></div>' +
    '</div>',
    {
      title: p.id ? 'Editar produto · ' + p.id : 'Novo produto',
      wide: true,
      foot: foot,
      onMount: function(root) {
        opcoesSelect_(root.querySelector('#pm-categoria'), listas.categorias || [], 'Selecione…', p.categoria);
        opcoesSelect_(root.querySelector('#pm-prioridade'), listas.prioridades || [], '—', p.prioridade || '⚪ Baixa');
        opcoesSelect_(root.querySelector('#pm-gancho'), listas.ganchos || [], '—', p.gancho);
        opcoesSelect_(root.querySelector('#pm-status'), listas.status_produto || [], '', p.status || '🆕 Novo');
        opcoesSelect_(root.querySelector('#pm-classif'), listas.classificacoes || [], '', p.classificacao || '🟡 EM TESTE');
        var precoEl = root.querySelector('#pm-preco');
        var pctEl = root.querySelector('#pm-pct');
        function updHint() {
          var v = arred2(parseDec(precoEl.value) * parseDec(pctEl.value) / 100);
          root.querySelector('#pm-cvhint').textContent = v > 0 ? '≈ ' + fmtMoeda(v) + ' por venda' : '';
        }
        precoEl.addEventListener('input', updHint);
        pctEl.addEventListener('input', updHint);
        updHint();
        root.querySelector('#pm-save').addEventListener('click', function() { salvarProduto_(root, p); });
        var gal = root.querySelector('#pm-gallery');
        if (gal) gal.addEventListener('click', function() { openProductGallery(p); });
      }
    }
  );
}
function marcarErro_(root, campo, msg) {
  var fld = root.querySelector('#fld-' + campo);
  if (!fld) return;
  fld.classList.add('err');
  var fe = fld.querySelector('.ferr');
  if (fe) fe.textContent = msg;
  setTimeout(function() { fld.classList.remove('err'); }, 900);
}
function salvarProduto_(root, p) {
  var payload = {
    id: p.id || '',
    produto: root.querySelector('#pm-produto').value.trim(),
    categoria: root.querySelector('#pm-categoria').value,
    preco: parseDec(root.querySelector('#pm-preco').value),
    comissaoPct: parseDec(root.querySelector('#pm-pct').value),
    prioridade: root.querySelector('#pm-prioridade').value,
    gancho: root.querySelector('#pm-gancho').value,
    status: root.querySelector('#pm-status').value,
    classificacao: root.querySelector('#pm-classif').value,
    link: root.querySelector('#pm-link').value.trim(),
    loja: root.querySelector('#pm-loja').value.trim(),
    obs: root.querySelector('#pm-obs').value.trim()
  };
  API.rpc('save_product', payload).then(function(r) {
    if (!r.ok) {
      if (r.campos) Object.keys(r.campos).forEach(function(k) { marcarErro_(root, k, r.campos[k]); });
      toast(r.message, 'error');
      return;
    }
    toast(r.message + (p.id ? '' : ' (ID ' + r.id + ')'), 'success');
    closeModal();
    return carregarTudo_(false).then(function() { flashRow_(r.id); });
  }).catch(function(e) { toast(e.message, 'error'); });
}
function flashRow_(id) {
  setTimeout(function() {
    $$('[data-id="' + id + '"]').forEach(function(tr) {
      if (tr.tagName === 'TR') { tr.classList.add('row-flash'); setTimeout(function() { tr.classList.remove('row-flash'); }, 1700); }
    });
  }, 80);
}
function arquivarProduto_(id) {
  var p = (state.data.produtos || []).filter(function(x) { return x.id === id; })[0];
  if (!p) return;
  confirmar('Arquivar <b>"' + esc(p.produto) + '"</b>?<br><small style="color:var(--text-3)">Ele sai da esteira como Descartado, mas o registro permanece para auditoria. Nada é apagado.</small>',
    'Arquivar', function() {
      API.rpc('remove_product', id).then(function(r) {
        if (!r.ok) throw new Error(r.message);
        toast(r.message, 'success');
        carregarTudo_(false);
      }).catch(function(e) { toast(e.message, 'error'); });
    }, true);
}

/* ============================================================
   19. MODAL — CONTEÚDO
   ============================================================ */
function openConteudoModal(c) {
  c = c || { novo: true };
  var listas = state.data.listas || {};
  var produtosAtivos = (state.data.produtos || []).filter(function(p) {
    return normKey(p.classificacao).indexOf('descartado') === -1;
  });
  var foot = '<button class="btn btn-ghost" data-close>Cancelar</button>' +
    '<button class="btn btn-primary" id="cm-save">' + (c.id ? 'Salvar alterações' : 'Registrar conteúdo') + '</button>';
  openModal(
    '<div class="form-grid">' +
    '<div class="field full" id="fld-produtoId"><label>Produto <i class="req">*</i></label><select class="select" id="cm-produto"></select><span class="ferr"></span></div>' +
    '<div class="field" id="fld-data"><label>Data de publicação <i class="req">*</i></label>' +
      '<input class="input" id="cm-data" type="date" value="' + esc(c.data || '') + '"><span class="ferr"></span></div>' +
    '<div class="field" id="fld-tipo"><label>Tipo de conteúdo <i class="req">*</i></label><select class="select" id="cm-tipo"></select><span class="ferr"></span></div>' +
    '<div class="field" id="fld-gancho"><label>Gancho <i class="req">*</i></label><select class="select" id="cm-gancho"></select><span class="ferr"></span></div>' +
    '<div class="field"><label>Status</label><select class="select" id="cm-status"></select></div>' +
    '<div class="field full" id="fld-titulo"><label>Título / hook <i class="req">*</i></label>' +
      '<input class="input" id="cm-titulo" type="text" value="' + esc(c.titulo || '') + '" placeholder="O que o vídeo promete?"><span class="ferr"></span></div>' +
    '<div class="field full"><label>URL do vídeo</label><input class="input" id="cm-url" type="text" value="' + esc(c.url || '') + '" placeholder="https://www.tiktok.com/…"></div>' +
    '<div class="field"><label>Visualizações</label><input class="input" id="cm-views" type="text" inputmode="numeric" value="' + esc(c.views || '') + '"></div>' +
    '<div class="field"><label>Curtidas</label><input class="input" id="cm-curtidas" type="text" inputmode="numeric" value="' + esc(c.curtidas || '') + '"></div>' +
    '<div class="field"><label>Comentários</label><input class="input" id="cm-comentarios" type="text" inputmode="numeric" value="' + esc(c.comentarios || '') + '"></div>' +
    '<div class="field"><label>Compartilhamentos</label><input class="input" id="cm-compartilh" type="text" inputmode="numeric" value="' + esc(c.compartilh || '') + '"></div>' +
    '<div class="field"><label>Cliques no produto</label><input class="input" id="cm-clicks" type="text" inputmode="numeric" value="' + esc(c.clicks || '') + '"></div>' +
    '<div class="field"><label>Carrinhos</label><input class="input" id="cm-carrinhos" type="text" inputmode="numeric" value="' + esc(c.carrinhos || '') + '"></div>' +
    '<div class="field"><label>Pedidos</label><input class="input" id="cm-pedidos" type="text" inputmode="numeric" value="' + esc(c.pedidos || '') + '"></div>' +
    '<div class="field"><label>Vendas</label><input class="input" id="cm-vendas" type="text" inputmode="numeric" value="' + esc(c.vendas || '') + '"></div>' +
    '<div class="field full" id="fld-comissao"><label>Comissão gerada (R$)</label>' +
      '<input class="input" id="cm-comissao" type="text" inputmode="decimal" value="' + esc(c.comissao !== undefined && c.comissao !== null && !c.novo ? c.comissao : '') + '" placeholder="calculada automaticamente">' +
      '<span class="fhint" id="cm-chint">Se vazio: vendas × comissão do produto.</span><span class="ferr"></span></div>' +
    '<div class="field full"><label>Observações</label><input class="input" id="cm-obs" type="text" value="' + esc(c.obs || '') + '"></div>' +
    '</div>',
    {
      title: c.id ? 'Editar conteúdo · ' + c.id : 'Registrar conteúdo',
      wide: true,
      foot: foot,
      onMount: function(root) {
        var sel = root.querySelector('#cm-produto');
        sel.innerHTML = '<option value="">Selecione…</option>' + produtosAtivos.map(function(p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === c.produtoId ? ' selected' : '') + '>' + esc(p.produto) + '</option>';
        }).join('');
        opcoesSelect_(root.querySelector('#cm-tipo'), listas.tipos_conteudo || [], 'Selecione…', c.tipo);
        opcoesSelect_(root.querySelector('#cm-gancho'), listas.ganchos || [], 'Selecione…', c.gancho);
        opcoesSelect_(root.querySelector('#cm-status'), listas.status_conteudo || [], '', c.status || '📊 Em análise');
        var pMapa = {};
        (state.data.produtos || []).forEach(function(p) { pMapa[p.id] = p; });
        function updHint() {
          if (state.comissaoTocado) return;
          var p = pMapa[sel.value];
          var v = Math.round(parseDec(root.querySelector('#cm-vendas').value));
          if (p && v > 0) root.querySelector('#cm-chint').textContent = 'Automático: ' + v + ' × ' + fmtMoeda(p.comissaoVenda) + ' = ' + fmtMoeda(v * p.comissaoVenda);
          else root.querySelector('#cm-chint').textContent = 'Se vazio: vendas × comissão do produto.';
        }
        sel.addEventListener('change', updHint);
        root.querySelector('#cm-vendas').addEventListener('input', updHint);
        root.querySelector('#cm-comissao').addEventListener('input', function() { state.comissaoTocado = !!root.querySelector('#cm-comissao').value.trim(); });
        updHint();
        root.querySelector('#cm-save').addEventListener('click', function() { salvarConteudo_(root, c); });
      }
    }
  );
}
function salvarConteudo_(root, c) {
  var payload = {
    id: c.id || '',
    produtoId: root.querySelector('#cm-produto').value,
    data: root.querySelector('#cm-data').value,
    tipo: root.querySelector('#cm-tipo').value,
    gancho: root.querySelector('#cm-gancho').value,
    status: root.querySelector('#cm-status').value,
    titulo: root.querySelector('#cm-titulo').value.trim(),
    url: root.querySelector('#cm-url').value.trim(),
    views: Math.round(parseDec(root.querySelector('#cm-views').value)),
    curtidas: Math.round(parseDec(root.querySelector('#cm-curtidas').value)),
    comentarios: Math.round(parseDec(root.querySelector('#cm-comentarios').value)),
    compartilh: Math.round(parseDec(root.querySelector('#cm-compartilh').value)),
    clicks: Math.round(parseDec(root.querySelector('#cm-clicks').value)),
    carrinhos: Math.round(parseDec(root.querySelector('#cm-carrinhos').value)),
    pedidos: Math.round(parseDec(root.querySelector('#cm-pedidos').value)),
    vendas: Math.round(parseDec(root.querySelector('#cm-vendas').value)),
    obs: root.querySelector('#cm-obs').value.trim()
  };
  var comRaw = root.querySelector('#cm-comissao').value.trim();
  if (comRaw !== '') payload.comissao = parseDec(comRaw);
  API.rpc('save_content', payload).then(function(r) {
    if (!r.ok) {
      if (r.campos) Object.keys(r.campos).forEach(function(k) { marcarErro_(root, k, r.campos[k]); });
      toast(r.message, 'error');
      return;
    }
    toast(r.message + (c.id ? '' : ' (ID ' + r.id + ')'), 'success');
    state.comissaoTocado = false;
    closeModal();
    return carregarTudo_(false).then(function() { flashRow_(r.id); });
  }).catch(function(e) { toast(e.message, 'error'); });
}
function arquivarConteudo_(id) {
  var c = (state.data.conteudos || []).filter(function(x) { return x.id === id; })[0];
  if (!c) return;
  confirmar('Arquivar o conteúdo <b>"' + esc(c.titulo) + '"</b>?<br><small style="color:var(--text-3)">Ele sai dos cálculos da esteira, mas o registro permanece para auditoria.</small>',
    'Arquivar', function() {
      API.rpc('remove_content', id).then(function(r) {
        if (!r.ok) throw new Error(r.message);
        toast(r.message, 'success');
        carregarTudo_(false);
      }).catch(function(e) { toast(e.message, 'error'); });
    }, true);
}

/* ============================================================
   20. CSV EXPORT
   ============================================================ */
function csvDownload(nome, linhas) {
  var csv = '\uFEFF' + linhas.map(function(l) {
    return l.map(function(c) {
      c = String(c === null || c === undefined ? '' : c);
      return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(';');
  }).join('\r\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function() { URL.revokeObjectURL(a.href); }, 4000);
}
function exportProdutosCSV(period) {
  var b = state.data;
  var pi = periodoInfo(period);
  var C = (b.conteudos || []).filter(function(c) {
    if (c.status === '❌ Arquivado') return false;
    var d = String(c.data || '').slice(0, 10);
    if (pi.inicio && d && d < pi.inicio) return false;
    return true;
  });
  var porP = {};
  C.forEach(function(c) {
    porP[c.produtoId] = porP[c.produtoId] || { videos: 0, vendas: 0, comissao: 0 };
    porP[c.produtoId].videos++; porP[c.produtoId].vendas += num(c.vendas); porP[c.produtoId].comissao += num(c.comissao);
  });
  var linhas = [['ID', 'Produto', 'Categoria', 'Preço', 'Comissão %', 'Comissão por venda', 'Status', 'Classificação', 'Prioridade', 'Vídeos', 'Vendas', 'Comissão total', 'Loja', 'Link', 'Observações']];
  (b.produtos || []).forEach(function(p) {
    var a = porP[p.id] || { videos: 0, vendas: 0, comissao: 0 };
    linhas.push([p.id, p.produto, p.categoria, p.preco, p.comissaoPct, p.comissaoVenda, p.status, p.classificacao, p.prioridade, a.videos, a.vendas, arred2(a.comissao), p.loja || '', p.link || '', p.obs || '']);
  });
  csvDownload('soessacena-produtos-' + hojeISO() + '.csv', linhas);
  toast('Exportação de produtos gerada.', 'success');
}
function exportConteudosCSV(period) {
  var b = state.data;
  var pi = periodoInfo(period);
  var linhas = [['ID', 'Data', 'Produto', 'Produto ID', 'Tipo', 'Gancho', 'Título', 'Status', 'Views', 'Curtidas', 'Comentários', 'Compartilhamentos', 'Cliques', 'Carrinhos', 'Pedidos', 'Vendas', 'Comissão', 'URL', 'Observações']];
  (b.conteudos || []).filter(function(c) {
    var d = String(c.data || '').slice(0, 10);
    if (pi.inicio && d && d < pi.inicio) return false;
    return true;
  }).forEach(function(c) {
    linhas.push([c.id, c.data, c.produto, c.produtoId, c.tipo, c.gancho, c.titulo, c.status, c.views, c.curtidas, c.comentarios, c.compartilh, c.clicks, c.carrinhos, c.pedidos, c.vendas, c.comissao, c.url || '', c.obs || '']);
  });
  csvDownload('soessacena-conteudos-' + hojeISO() + '.csv', linhas);
  toast('Exportação de conteúdos gerada.', 'success');
}

/* ============================================================
   21. BUSCA GLOBAL
   ============================================================ */
function bindSearch_() {
  var inp = $('#global-search');
  var box = $('#search-results');
  var deb = debounce(function() {
    var q = normKey(inp.value);
    if (!q || q.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var res = [];
    (state.data.produtos || []).forEach(function(p) {
      if (normKey(p.produto + ' ' + p.categoria + ' ' + p.id).indexOf(q) > -1) res.push({ tipo: 'p', id: p.id, txt: p.produto, sub: p.categoria });
    });
    (state.data.conteudos || []).forEach(function(c) {
      if (normKey(c.titulo + ' ' + c.produto + ' ' + c.id).indexOf(q) > -1) res.push({ tipo: 'c', id: c.id, txt: c.titulo, sub: c.produto });
    });
    var cats = {};
    (state.data.produtos || []).forEach(function(p) { cats[p.categoria] = 1; });
    Object.keys(cats).forEach(function(cat) {
      if (normKey(cat).indexOf(q) > -1) res.push({ tipo: 'cat', id: cat, txt: cat, sub: 'categoria' });
    });
    ExtraStore.load().tarefas.forEach(function(t) {
      if (normKey(t.titulo + ' ' + t.dono + ' ' + (t.cat || '')).indexOf(q) > -1) res.push({ tipo: 't', id: t.data, txt: t.titulo, sub: t.dono + ' · ' + fmtData(t.data) });
    });
    if (!res.length) { box.classList.add('hidden'); return; }
    box.innerHTML = res.slice(0, 9).map(function(r) {
      return '<div class="sr-item" data-tipo="' + r.tipo + '" data-id="' + esc(r.id) + '">' +
        '<span class="sr-tag ' + (r.tipo === 'p' ? 'p' : r.tipo === 'c' ? 'c' : r.tipo === 't' ? 't' : 'cat') + '">' +
        (r.tipo === 'p' ? 'Produto' : r.tipo === 'c' ? 'Conteúdo' : r.tipo === 't' ? 'Tarefa' : 'Categoria') + '</span>' +
        '<span class="sr-txt">' + esc(r.txt) + '</span><span class="sr-sub">' + esc(r.sub) + '</span></div>';
    }).join('');
    box.classList.remove('hidden');
    box.querySelectorAll('.sr-item').forEach(function(el) {
      el.addEventListener('mousedown', function() {
        var t = el.getAttribute('data-tipo');
        box.classList.add('hidden');
        inp.value = '';
        if (t === 'p') { showView('cadastro'); var p = state.data.produtos.filter(function(x) { return x.id === el.getAttribute('data-id'); })[0]; if (p) openProdutoModal(p); }
        else if (t === 'c') { showView('conteudos'); var c = state.data.conteudos.filter(function(x) { return x.id === el.getAttribute('data-id'); })[0]; if (c) openConteudoModal(c); }
        else if (t === 't') {
          var dt = new Date(el.getAttribute('data-id') + 'T12:00:00');
          state.agenda.ano = dt.getFullYear(); state.agenda.mes = dt.getMonth(); state.agenda.sel = el.getAttribute('data-id');
          showView('agenda');
        }
        else { state.dashF.categoria = el.getAttribute('data-id'); $('#f-categoria').value = el.getAttribute('data-id'); showView('dashboard'); renderDashboard(); }
      });
    });
  }, 160);
  inp.addEventListener('input', function() { deb(); });
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var first = box.querySelector('.sr-item');
      if (first) first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
    if (e.key === 'Escape') { box.classList.add('hidden'); inp.value = ''; }
  });
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.search')) box.classList.add('hidden');
  });
}

/* ============================================================
   21b. PLAYER DE VÍDEO + GALERIA (embed oficial do TikTok)
   ============================================================ */
function openVideoPlayer(c) {
  var vid = tiktokVideoId(c.url);
  var body = vid
    ? '<div class="vplayer"><div class="phone-frame">' +
        '<iframe src="https://www.tiktok.com/embed/v2/' + encodeURIComponent(vid) +
        '" title="' + esc(c.titulo || 'Vídeo do TikTok') +
        '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe>' +
      '</div>' +
      '<div class="vp-actions">' +
        '<a class="btn btn-ghost sm" href="' + esc(c.url) + '" target="_blank" rel="noopener">Abrir no TikTok ↗</a>' +
        '<button class="btn btn-ghost sm" id="vp-reload">↻ Recarregar player</button>' +
      '</div></div>'
    : '<p class="confirm-txt">Não consegui extrair o ID deste link para exibir o player aqui. ' +
      'Use um link completo do vídeo, por exemplo:<br><code>https://www.tiktok.com/@usuario/video/7xxxxxxxxxxxxxxxx</code></p>' +
      (c.url ? '<div class="vp-actions" style="margin-top:14px"><a class="btn btn-primary sm" href="' + esc(c.url) + '" target="_blank" rel="noopener">Abrir no TikTok ↗</a></div>' : '');
  openModal(body, { title: c.titulo || 'Vídeo' });
  var rb = $('#vp-reload');
  if (rb) rb.addEventListener('click', function() {
    var f = document.querySelector('.phone-frame iframe');
    if (f) f.src = f.src;
  });
}
function videosDoProduto(pid) {
  return (state.data.conteudos || []).filter(function(c) {
    return c.produtoId === pid && tiktokVideoId(c.url);
  });
}
function openProductGallery(p) {
  var vids = videosDoProduto(p.id);
  var body = vids.length
    ? vids.map(function(c) {
        return '<div class="pv-row" data-cid="' + esc(c.id) + '">' +
          '<span class="pv-ic"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>' +
          '<div class="pv-txt"><div class="pv-title">' + esc(c.titulo) + '</div>' +
          '<div class="pv-meta">' + fmtData(c.data) + ' · ' + fmtCompact(c.views) + ' views · ' + c.vendas + ' vendas</div></div>' +
          '<span class="badge b-cyan">▶ assistir</span></div>';
      }).join('')
    : '<p class="confirm-txt">Este produto ainda não tem vídeos com link do TikTok. Edite o conteúdo e cole a URL do vídeo publicada.</p>';
  openModal(body, { title: '🎬 Vídeos · ' + p.produto });
  $$('#modal-root .pv-row').forEach(function(r) {
    r.addEventListener('click', function() {
      var c = (state.data.conteudos || []).filter(function(x) { return x.id === r.getAttribute('data-cid'); })[0];
      if (c) openVideoPlayer(c);
    });
  });
}
function renderVideoGallery() {
  var sec = $('#video-gallery-section');
  var box = $('#video-gallery');
  if (!sec || !box || !state.data) return;
  var pMapa = {};
  (state.data.produtos || []).forEach(function(p) { pMapa[p.id] = p; });
  var grupos = [], gMapa = {};
  (state.data.conteudos || []).forEach(function(c) {
    if (!tiktokVideoId(c.url)) return;
    var st = normKey(c.status);
    if (st.indexOf('publicado') === -1 && st.indexOf('vencedor') === -1 && st.indexOf('analise') === -1) return;
    var key = c.produtoId;
    if (!gMapa[key]) { gMapa[key] = { nome: c.produto || '—', items: [] }; grupos.push(gMapa[key]); }
    gMapa[key].items.push(c);
  });
  var total = grupos.reduce(function(a, g) { return a + g.items.length; }, 0);
  if (!total) { sec.classList.add('hidden'); box.innerHTML = ''; return; }
  sec.classList.remove('hidden');
  box.innerHTML = grupos.map(function(g) {
    return '<div class="vgal-group"><div class="vgal-ghead"><h4>' + esc(g.nome) + '</h4>' +
      '<span class="vgal-count">' + g.items.length + '</span></div><div class="vgal-grid">' +
      g.items.map(function(c) {
        return '<div class="vthumb" data-vid="' + esc(c.id) + '" title="Assistir: ' + esc(c.titulo) + '">' +
          '<span class="vthumb-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg></span>' +
          '<span class="vthumb-title">' + esc(c.titulo) + '</span>' +
          '<span class="vthumb-meta"><span>▶ ' + fmtCompact(c.views) + '</span><span>🛒 ' + num(c.vendas) + '</span></span>' +
        '</div>';
      }).join('') + '</div></div>';
  }).join('');
  box.querySelectorAll('.vthumb').forEach(function(t) {
    t.addEventListener('click', function() {
      var c = (state.data.conteudos || []).filter(function(x) { return x.id === t.getAttribute('data-vid'); })[0];
      if (c) openVideoPlayer(c);
    });
  });
}

/* ============================================================
   21c. PERFIL TIKTOK (banner na aba Conteúdos)
   ============================================================ */
function ttHandleLimpo(u) {
  return String(u || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').replace(/\/.*$/, '');
}
function renderPerfilTikTok() {
  var box = $('#tt-profile-card');
  if (!box || !state.data) return;
  var pf = ExtraStore.load().perfil || {};
  if (!pf.user && !pf.url) { box.innerHTML = ''; return; }
  var h = ttHandleLimpo(pf.user || pf.url);
  var url = pf.url || (h ? 'https://www.tiktok.com/@' + h : '');
  var vids = (state.data.conteudos || []).filter(function(c) { return tiktokVideoId(c.url); }).length;
  var pub = (state.data.conteudos || []).filter(function(c) {
    var st = normKey(c.status);
    return st.indexOf('publicado') > -1 || st.indexOf('vencedor') > -1;
  }).length;
  var vendas = 0;
  (state.data.conteudos || []).forEach(function(c) { vendas += num(c.vendas); });
  box.innerHTML =
    '<div class="tt-profile">' +
      '<div class="tt-avatar">' + esc((h || 'T').charAt(0).toUpperCase()) + '</div>' +
      '<div class="tt-info">' +
        '<div class="tt-handle">@' + esc(h || 'seu_usuario') + '</div>' +
        '<div class="tt-meta">' +
          (pf.seguidores ? '<span class="tt-chip">👥 <b>' + fmtCompact(pf.seguidores) + '</b> seguidores</span>' : '') +
          '<span class="tt-chip">🎬 <b>' + pub + '</b> publicados</span>' +
          '<span class="tt-chip">🔗 <b>' + vids + '</b> com player</span>' +
          '<span class="tt-chip">🛒 <b>' + fmtInt(vendas) + '</b> vendas via conteúdo</span>' +
        '</div>' +
      '</div>' +
      (url ? '<a class="tt-cta" href="' + esc(url) + '" target="_blank" rel="noopener">' +
        '<svg viewBox="0 0 64 64" fill="currentColor"><path d="M43.4 8.2h-9.2v37.2a8.5 8.5 0 1 1-8.5-8.5c.5 0 1 .05 1.5.13v-9.3a17.9 17.9 0 0 0-1.5-.07 17.8 17.8 0 1 0 17.8 17.8V26.6a25.2 25.2 0 0 0 14.2 4.37v-9.2a16.4 16.4 0 0 1-14.3-13.57z"/></svg>' +
        'Abrir perfil ↗</a>' : '') +
    '</div>';
}

/* ============================================================
   21d. AGENDA DO CASAL (calendário + tarefas)
   ============================================================ */
var MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
var DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
var TASK_CATS = ['🎬 Gravação', '✂️ Edição', '📤 Postagem', '🛍️ Compras', '🏠 Casa', '💼 Trabalho', '📦 Entrega', '💡 Ideia', '📌 Outro'];
var TASK_DONOS = ['JottaPe', 'Suzana'];
var TASK_PRIOS = ['🔥 Alta', '🟡 Média', '⚪ Baixa'];
function donoClasse(d) { return (d === 'Esposa' || d === 'Suzana') ? 'esposa' : 'eu'; }
function donoLabel(d) { if (d === 'Esposa') return 'Suzana'; if (d === 'Eu') return 'JottaPe'; return d; }
function isoData(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function tarefasDoDia(iso) {
  var f = ExtraStore.load().filtro;
  var arr = ExtraStore.load().tarefas.filter(function(t) {
    if (t.data !== iso) return false;
    if (f === 'pend' && t.done) return false;
    if (f === 'done' && !t.done) return false;
    return true;
  });
  arr.sort(function(a, b) {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    return (a.hora || '99:99') < (b.hora || '99:99') ? -1 : 1;
  });
  return arr;
}
function tarefaById(id) {
  return (ExtraStore.load().tarefas || []).filter(function(t) { return t.id === id; })[0];
}
function renderAgenda() {
  if (!ExtraStore.state) ExtraStore.load();
  if (!state.agenda.ano) {
    var h = new Date();
    state.agenda.ano = h.getFullYear();
    state.agenda.mes = h.getMonth();
    state.agenda.sel = hojeISO();
  }
  renderAgendaSummary();
  renderAgendaMonth();
  renderAgendaDayPanel();
}
function renderAgendaSummary() {
  var box = $('#agenda-summary');
  if (!box) return;
  var T = ExtraStore.load().tarefas;
  var hj = hojeISO();
  var d = new Date();
  var dow = (d.getDay() + 6) % 7; // segunda = 0
  var ini = isoData(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow));
  var fim = isoData(new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow + 6));
  var pendHoje = 0, pendEu = 0, pendEsp = 0, pendSemana = 0;
  T.forEach(function(t) {
    if (t.done) return;
    if (t.data === hj) pendHoje++;
    if (t.data >= ini && t.data <= fim) pendSemana++;
    if (t.dono === 'Esposa' || t.dono === 'Suzana') pendEsp++; else pendEu++;
  });
  function card(ic, glow, cor, label, val, foot) {
    return '<div class="kpi compact" style="--kpi-glow:' + glow + '"><div class="kpi-top">' +
      '<span class="kpi-ic" style="color:' + cor + ';background:rgba(255,255,255,.045);border:1px solid var(--border)">' +
      '<span style="width:15px;height:15px;display:block">' + ic + '</span></span>' +
      '<span class="kpi-label">' + label + '</span></div>' +
      '<div class="kpi-value">' + val + '</div><div class="kpi-foot">' + foot + '</div></div>';
  }
  box.innerHTML =
    card(ICONS.check, 'rgba(37,244,238,.12)', 'var(--aqua)', 'Pendentes hoje', pendHoje,
      '<span class="kpi-note">' + (pendHoje ? 'mãos à obra 💪' : 'tudo em dia 🎉') + '</span>') +
    card(ICONS.cursor, 'rgba(37,244,238,.10)', 'var(--aqua)', 'JottaPe · pendentes', pendEu, '<span class="kpi-note">todas as datas</span>') +
    card(ICONS.heart, 'rgba(254,44,85,.12)', 'var(--rosa)', 'Suzana · pendentes', pendEsp, '<span class="kpi-note">todas as datas</span>') +
    card(ICONS.calendar, 'rgba(255,210,76,.10)', 'var(--gold)', 'Pendentes na semana', pendSemana, '<span class="kpi-note">seg → dom</span>');
}
function renderAgendaMonth() {
  var a = state.agenda;
  $('#ag-month').textContent = MESES_PT[a.mes] + ' ' + a.ano;
  var first = new Date(a.ano, a.mes, 1);
  var startDow = first.getDay();
  var diasNoMes = new Date(a.ano, a.mes + 1, 0).getDate();
  var hoje = hojeISO();
  var cells = [];
  var totalDias = Math.ceil((startDow + diasNoMes) / 7) * 7;
  var cursor = new Date(a.ano, a.mes, 1 - startDow);
  for (var i = 0; i < totalDias; i++) {
    var iso = isoData(cursor);
    var ts = tarefasDoDia(iso);
    var out = cursor.getMonth() !== a.mes;
    var cls = 'cal-cell' + (out ? ' out' : '') + (iso === hoje ? ' today' : '') + (iso === a.sel ? ' sel' : '');
    var chips = ts.slice(0, 3).map(function(t) {
      return '<span class="cal-chip ' + donoClasse(t.dono) + (t.done ? ' done' : '') + '">' + esc(t.titulo) + '</span>';
    }).join('');
    if (ts.length > 3) chips += '<span class="cal-more">+' + (ts.length - 3) + '</span>';
    cells.push('<div class="' + cls + '" data-date="' + iso + '">' +
      '<span class="cal-num">' + cursor.getDate() + '</span>' +
      '<div class="cal-chips">' + chips + '</div></div>');
    cursor.setDate(cursor.getDate() + 1);
  }
  $('#agenda-cal').innerHTML = cells.join('');
}
function renderAgendaDayPanel() {
  var box = $('#agenda-day-panel');
  if (!box) return;
  var iso = state.agenda.sel;
  var dt = new Date(iso + 'T12:00:00');
  var ts = tarefasDoDia(iso);
  var pend = ts.filter(function(t) { return !t.done; }).length;
  function grupo(dono, corCls) {
    var items = ts.filter(function(t) { return donoLabel(t.dono) === dono; });
    if (!items.length) return '';
    var rows = items.map(function(t) {
      return '<div class="task-row' + (t.done ? ' done' : '') + '">' +
        '<input type="checkbox" class="task-check ' + corCls + '" data-tid="' + esc(t.id) + '"' + (t.done ? ' checked' : '') + '>' +
        '<div class="task-body"><div class="task-title">' + esc(t.titulo) + '</div>' +
        '<div class="task-meta">' +
          (t.hora ? '<span class="task-tag">🕐 ' + esc(t.hora) + '</span>' : '') +
          (t.cat ? '<span class="task-tag">' + esc(t.cat) + '</span>' : '') +
          (t.prio ? '<span class="task-tag">' + esc(t.prio) + '</span>' : '') +
        '</div></div>' +
        '<button class="icon-btn task-edit" data-tid="' + esc(t.id) + '" title="Editar tarefa">' + ICONS.edit + '</button>' +
      '</div>';
    }).join('');
    var feitas = items.filter(function(t) { return t.done; }).length;
    return '<div class="dp-sec"><span class="dp-dot ' + corCls + '"></span>' + esc(dono) +
      '<span class="dp-count">' + feitas + '/' + items.length + '</span></div>' + rows;
  }
  box.innerHTML =
    '<div class="dp-head"><div><div class="dp-date">' +
      dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' }) +
      '<small>' + DIAS_SEMANA[dt.getDay()] + (iso === hojeISO() ? ' · hoje' : '') + '</small></div></div>' +
      '<button class="btn btn-primary sm" id="dp-add">+ Tarefa</button></div>' +
    '<div class="dp-sub">' + ts.length + ' tarefa' + (ts.length === 1 ? '' : 's') + ' · <b>' + pend + ' pendente' + (pend === 1 ? '' : 's') + '</b></div>' +
    (ts.length
      ? grupo('JottaPe', 'eu') + grupo('Suzana', 'esposa')
      : '<div class="dp-empty">Nenhuma tarefa neste dia.<br>Toque em <b>+ Tarefa</b> para adicionar. ✨</div>');
}
function abrirModalTarefa(t) {
  t = t || {};
  var optsDono = TASK_DONOS.map(function(d) {
    return '<option value="' + d + '"' + ((t.dono || 'JottaPe') === d ? ' selected' : '') + '>' + d + '</option>';
  }).join('');
  var optsCat = TASK_CATS.map(function(c) {
    return '<option value="' + esc(c) + '"' + (t.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
  }).join('');
  var optsPrio = TASK_PRIOS.map(function(p) {
    return '<option value="' + esc(p) + '"' + ((t.prio || '🟡 Média') === p ? ' selected' : '') + '>' + esc(p) + '</option>';
  }).join('');
  var foot =
    (t.id ? '<button class="btn btn-danger" id="tm-del">Excluir</button>' : '') +
    '<button class="btn btn-ghost" data-close>Cancelar</button>' +
    '<button class="btn btn-primary" id="tm-save">' + (t.id ? 'Salvar' : 'Adicionar') + '</button>';
  openModal(
    '<div class="form-grid">' +
    '<div class="field full" id="fld-titulo"><label>Tarefa <i class="req">*</i></label>' +
      '<input class="input" id="tm-titulo" type="text" value="' + esc(t.titulo || '') + '" placeholder="O que precisa ser feito?" maxlength="140"><span class="ferr"></span></div>' +
    '<div class="field"><label>Responsável</label><select class="select" id="tm-dono">' + optsDono + '</select></div>' +
    '<div class="field"><label>Categoria</label><select class="select" id="tm-cat"><option value="">—</option>' + optsCat + '</select></div>' +
    '<div class="field" id="fld-data"><label>Data <i class="req">*</i></label><input class="input" id="tm-data" type="date" value="' + esc(t.data || state.agenda.sel || hojeISO()) + '"><span class="ferr"></span></div>' +
    '<div class="field"><label>Horário</label><input class="input" id="tm-hora" type="time" value="' + esc(t.hora || '') + '"></div>' +
    '<div class="field"><label>Prioridade</label><select class="select" id="tm-prio">' + optsPrio + '</select></div>' +
    '<div class="field"><label>Situação</label><select class="select" id="tm-done">' +
      '<option value="">⏳ Pendente</option><option value="1"' + (t.done ? ' selected' : '') + '>✅ Concluída</option></select></div>' +
    '<div class="field full"><label>Observações</label><input class="input" id="tm-obs" type="text" value="' + esc(t.obs || '') + '" placeholder="detalhes, links, combinados…"></div>' +
    '</div>',
    { title: t.id ? 'Editar tarefa' : 'Nova tarefa', wide: false, foot: foot, onMount: function(root) {
        root.querySelector('#tm-save').addEventListener('click', function() { salvarTarefa_(root, t); });
        var del = root.querySelector('#tm-del');
        if (del) del.addEventListener('click', function() { excluirTarefa_(t.id); });
      } }
  );
}
function salvarTarefa_(root, t) {
  var titulo = root.querySelector('#tm-titulo').value.trim();
  var data = root.querySelector('#tm-data').value;
  if (!titulo) { marcarErro_(root, 'titulo', 'Descreva a tarefa.'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { marcarErro_(root, 'data', 'Escolha a data.'); return; }
  var ex = ExtraStore.load();
  var alvo = t.id ? tarefaById(t.id) : null;
  var novo = !alvo;
  if (novo) { alvo = { id: ExtraStore.nextTaskId() }; ex.tarefas.push(alvo); }
  alvo.titulo = titulo;
  alvo.dono = root.querySelector('#tm-dono').value;
  alvo.data = data;
  alvo.hora = root.querySelector('#tm-hora').value;
  alvo.cat = root.querySelector('#tm-cat').value;
  alvo.prio = root.querySelector('#tm-prio').value;
  alvo.done = root.querySelector('#tm-done').value === '1';
  alvo.obs = root.querySelector('#tm-obs').value.trim();
  ExtraStore.save();
  toast(novo ? 'Tarefa adicionada à agenda. 📅' : 'Tarefa atualizada.', 'success');
  state.agenda.sel = data;
  closeModal();
  renderAgenda();
}
function excluirTarefa_(id) {
  var t = tarefaById(id);
  if (!t) { closeModal(); return; }
  confirmar('Excluir a tarefa <b>"' + esc(t.titulo) + '"</b>?', 'Excluir', function() {
    var ex = ExtraStore.load();
    ex.tarefas = ex.tarefas.filter(function(x) { return x.id !== id; });
    ExtraStore.save();
    toast('Tarefa excluída.', 'success');
    closeModal();
    renderAgenda();
  }, true);
}
function bindAgendaEvents_() {
  var prev = $('#ag-prev'), next = $('#ag-next'), hoje = $('#ag-today');
  if (!prev) return;
  prev.addEventListener('click', function() {
    state.agenda.mes--;
    if (state.agenda.mes < 0) { state.agenda.mes = 11; state.agenda.ano--; }
    renderAgendaMonth();
  });
  next.addEventListener('click', function() {
    state.agenda.mes++;
    if (state.agenda.mes > 11) { state.agenda.mes = 0; state.agenda.ano++; }
    renderAgendaMonth();
  });
  hoje.addEventListener('click', function() {
    var d = new Date();
    state.agenda.ano = d.getFullYear(); state.agenda.mes = d.getMonth(); state.agenda.sel = hojeISO();
    renderAgenda();
  });
  $('#agenda-cal').addEventListener('click', function(e) {
    var cell = e.target.closest('.cal-cell');
    if (!cell) return;
    state.agenda.sel = cell.getAttribute('data-date');
    renderAgendaMonth();
    renderAgendaDayPanel();
  });
  $('#agenda-day-panel').addEventListener('click', function(e) {
    if (e.target.closest('#dp-add')) { abrirModalTarefa({ data: state.agenda.sel }); return; }
    var ed = e.target.closest('.task-edit');
    if (ed) { var t = tarefaById(ed.getAttribute('data-tid')); if (t) abrirModalTarefa(t); }
  });
  $('#agenda-day-panel').addEventListener('change', function(e) {
    if (!e.target.classList.contains('task-check')) return;
    var t = tarefaById(e.target.getAttribute('data-tid'));
    if (!t) return;
    t.done = e.target.checked;
    ExtraStore.save();
    renderAgenda();
    toast(t.done ? '✅ "' + t.titulo + '" concluída!' : 'Tarefa reaberta.', t.done ? 'success' : 'info');
  });
  $('#ag-filter').addEventListener('click', function(e) {
    var b = e.target.closest('button[data-tf]');
    if (!b) return;
    ExtraStore.load().filtro = b.getAttribute('data-tf');
    $$('#ag-filter button').forEach(function(x) { x.classList.toggle('on', x === b); });
    renderAgendaMonth();
    renderAgendaDayPanel();
  });
}

/* ============================================================
   21e. VENDAS — registro rápido (livro-caixa independente)
   Salvo no ExtraStore; preço/comissão congelados no momento
   da venda a partir do cadastro do produto.
   ============================================================ */
function nextVendaId() {
  var mx = 0;
  (ExtraStore.load().vendas || []).forEach(function(v) {
    var m = String(v.id || '').match(/(\d+)$/);
    if (m && Number(m[1]) > mx) mx = Number(m[1]);
  });
  return 'VND-' + String(mx + 1).padStart(4, '0');
}
function produtoById_(id) {
  return ((state.data && state.data.produtos) || []).filter(function(p) { return p.id === id; })[0];
}
function vendasPeriodo(period, fProduto) {
  var ex = ExtraStore.load();
  if (!Array.isArray(ex.vendas)) ex.vendas = [];
  var pi = periodoInfo(period);
  return ex.vendas.filter(function(v) {
    if (fProduto && v.produtoId !== fProduto) return false;
    var d = String(v.data || '').slice(0, 10);
    if (!d) return false;
    if (pi.inicio && d < pi.inicio) return false;
    return true;
  }).sort(function(a, b) {
    if (a.data !== b.data) return a.data < b.data ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}
function preencherSelectsVendas_() {
  var ativos = (state.data.produtos || []).filter(function(p) {
    return normKey(p.classificacao).indexOf('descartado') === -1;
  }).sort(function(a, b) { return String(a.produto).localeCompare(String(b.produto), 'pt-BR'); });
  var vq = $('#vq-produto');
  var cur1 = vq.value;
  vq.innerHTML = '<option value="">Escolha o produto…</option>' + ativos.map(function(p) {
    return '<option value="' + esc(p.id) + '">' + esc(p.produto) + ' — ' + fmtMoeda(p.preco) + '</option>';
  }).join('');
  if (cur1 && produtoById_(cur1)) vq.value = cur1;
  var vf = $('#vf-produto');
  var cur2 = vf.value;
  vf.innerHTML = '<option value="">Produto: todos</option>' + ativos.map(function(p) {
    return '<option value="' + esc(p.id) + '"' + (p.id === cur2 ? ' selected' : '') + '>' + esc(p.produto) + '</option>';
  }).join('');
}
function atualizarHintVendaQuick_() {
  var hint = $('#vq-hint');
  if (!hint) return;
  var p = produtoById_($('#vq-produto').value);
  var qtd = Math.max(1, Math.round(parseDec($('#vq-qtd').value)) || 1);
  if (!p) {
    hint.textContent = 'A comissão por unidade é calculada automaticamente a partir do preço e do percentual cadastrados no produto.';
    return;
  }
  hint.innerHTML = '<b style="color:var(--text-2)">' + esc(p.produto) + '</b> · ' + fmtMoeda(p.preco) +
    ' · comissão de ' + num(p.comissaoPct).toLocaleString('pt-BR') + '% = <b style="color:var(--aqua)">' + fmtMoeda(p.comissaoVenda) + ' por unidade</b>' +
    (qtd > 1 ? ' · ' + qtd + ' un = <b style="color:var(--aqua)">' + fmtMoeda(arred2(qtd * num(p.comissaoVenda))) + '</b>' : '');
}
function renderVendas() {
  if (!state.data) return;
  var period = $('#vf-period').value;
  var fProd = state.vendasF.produto;
  preencherSelectsVendas_();
  if (!$('#vq-data').value) $('#vq-data').value = hojeISO();
  atualizarHintVendaQuick_();
  var lista = vendasPeriodo(period, fProd);

  var un = 0, receita = 0, comissao = 0;
  lista.forEach(function(v) {
    un += num(v.qtd);
    receita += num(v.qtd) * num(v.precoUnit);
    comissao += num(v.qtd) * num(v.comissaoUnit);
  });
  $('#vendas-sub').textContent = lista.length + ' registro(s) no período · ' + fmtInt(un) + ' unidade(s) vendida(s)';

  var hj = hojeISO();
  var hjUn = 0, hjCom = 0;
  (ExtraStore.load().vendas || []).forEach(function(v) {
    if (String(v.data).slice(0, 10) !== hj) return;
    hjUn += num(v.qtd); hjCom += num(v.qtd) * num(v.comissaoUnit);
  });
  function stripCard_(label, val, sub) {
    return '<div class="meta"><div class="meta-top"><span class="meta-label">' + label + '</span>' +
      '<span class="meta-nums">' + sub + '</span></div><div class="vd-val">' + val + '</div></div>';
  }
  $('#vendas-strip').innerHTML =
    stripCard_('Unidades vendidas', fmtInt(un), lista.length + ' registro(s)') +
    stripCard_('Faturamento', fmtMoeda(arred2(receita)), un ? 'ticket ' + fmtMoeda(arred2(receita / un)) : '—') +
    stripCard_('Comissão gerada', fmtMoeda(arred2(comissao)), un ? 'média ' + fmtMoeda(arred2(comissao / un)) + '/un' : '—') +
    stripCard_('Hoje', hjUn + ' un', hjCom > 0 ? fmtMoeda(arred2(hjCom)) + ' de comissão' : 'sem vendas');

  var totalGeral = (ExtraStore.load().vendas || []).length;
  if (!totalGeral) {
    $('#vendas-hero').classList.remove('hidden');
    $('#vendas-hero').innerHTML = heroHtml('🛒', 'Nenhuma venda registrada ainda',
      'Use a "Venda rápida" acima: escolha o produto, a quantidade e a data. A comissão é calculada automaticamente pelo percentual cadastrado no produto. Vendas vindas de vídeos continuam sendo registradas junto com cada conteúdo.', '');
  } else {
    $('#vendas-hero').classList.add('hidden');
  }

  if (!lista.length) {
    $('#vendas-tbody').innerHTML = '<tr><td colspan="8"><div class="list-empty">Nenhuma venda no período' + (fProd ? ' para este produto' : '') + '.</div></td></tr>';
  } else {
    $('#vendas-tbody').innerHTML = lista.map(function(v) {
      return '<tr data-id="' + esc(v.id) + '">' +
        '<td><span class="td-sub">' + fmtData(v.data) + '</span></td>' +
        '<td><div class="td-strong">' + esc(v.produto) + '</div><div class="td-sub">' + esc(v.produtoId) + '</div></td>' +
        '<td class="num"><b>' + num(v.qtd) + '</b></td>' +
        '<td class="num">' + fmtMoeda(v.precoUnit) + '</td>' +
        '<td class="num">' + fmtMoeda(arred2(num(v.qtd) * num(v.precoUnit))) + '</td>' +
        '<td class="num"><b>' + fmtMoeda(arred2(num(v.qtd) * num(v.comissaoUnit))) + '</b></td>' +
        '<td><span class="td-sub">' + esc(v.obs || '') + '</span></td>' +
        '<td class="td-actions">' +
          '<button class="icon-btn" data-act="edit-venda" data-id="' + esc(v.id) + '" title="Editar">' + ICONS.edit + '</button>' +
          '<button class="icon-btn" data-act="del-venda" data-id="' + esc(v.id) + '" title="Excluir">' + ICONS.trash + '</button>' +
        '</td></tr>';
    }).join('');
  }

  var mapa = {};
  lista.forEach(function(v) {
    mapa[v.produtoId] = mapa[v.produtoId] || { nome: v.produto, un: 0, comissao: 0 };
    mapa[v.produtoId].un += num(v.qtd);
    mapa[v.produtoId].comissao += num(v.qtd) * num(v.comissaoUnit);
  });
  var items = Object.keys(mapa).map(function(k) {
    var m = mapa[k];
    return { nome: m.nome, v: arred2(m.comissao), sub: m.un + ' un' };
  }).sort(function(a, z) { return z.v - a.v; }).slice(0, 8);
  bars($('#vendas-por-produto'), items, { moeda: true, grads: ['', 'gold', 'blue', 'violet'] });
  $('#vendas-hist-hint').textContent = lista.length + ' registro(s) no período';
  lineChart($('#vendas-chart-dia'), serieVendasDia_(period), { cor: '#25F4EE', sufixo: 'un' });
}
function registrarVendaQuick_() {
  var pid = $('#vq-produto').value;
  var qtd = Math.round(parseDec($('#vq-qtd').value));
  var data = $('#vq-data').value || hojeISO();
  var obs = $('#vq-obs').value.trim();
  var p = produtoById_(pid);
  if (!p) { toast('Escolha o produto vendido.', 'warn'); return; }
  if (!qtd || qtd < 1) { toast('A quantidade deve ser 1 ou mais.', 'warn'); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { toast('Data inválida.', 'warn'); return; }
  var ex = ExtraStore.load();
  if (!Array.isArray(ex.vendas)) ex.vendas = [];
  var id = nextVendaId();
  ex.vendas.push({
    id: id, produtoId: p.id, produto: p.produto, data: data, qtd: qtd,
    precoUnit: num(p.preco), comissaoUnit: num(p.comissaoVenda), obs: obs
  });
  ExtraStore.save();
  toast('Venda registrada: ' + qtd + '× ' + p.produto + ' · comissão ' + fmtMoeda(arred2(qtd * num(p.comissaoVenda))) + ' 🛒', 'success');
  $('#vq-qtd').value = '1';
  $('#vq-obs').value = '';
  $('#vq-data').value = hojeISO();
  atualizarHintVendaQuick_();
  renderVendas();
  flashRow_(id);
}
function abrirModalVenda(v) {
  v = v || {};
  var ativos = (state.data.produtos || []).filter(function(p) {
    return normKey(p.classificacao).indexOf('descartado') === -1 || p.id === v.produtoId;
  }).sort(function(a, b) { return String(a.produto).localeCompare(String(b.produto), 'pt-BR'); });
  var opts = ativos.map(function(p) {
    return '<option value="' + esc(p.id) + '"' + (p.id === v.produtoId ? ' selected' : '') + '>' + esc(p.produto) + '</option>';
  }).join('');
  openModal(
    '<div class="form-grid">' +
    '<div class="field full"><label>Produto</label><select class="select" id="vm-produto">' + opts + '</select>' +
      '<span class="fhint">Preço e comissão por unidade seguem o cadastro atual do produto.</span></div>' +
    '<div class="field"><label>Quantidade</label><input class="input" id="vm-qtd" type="text" inputmode="numeric" value="' + esc(v.qtd || 1) + '"></div>' +
    '<div class="field"><label>Data</label><input class="input" id="vm-data" type="date" value="' + esc(v.data || hojeISO()) + '"></div>' +
    '<div class="field full"><label>Observações</label><input class="input" id="vm-obs" type="text" value="' + esc(v.obs || '') + '"></div>' +
    '</div>',
    { title: v.id ? 'Editar venda · ' + v.id : 'Nova venda', foot:
      '<button class="btn btn-ghost" data-close>Cancelar</button>' +
      '<button class="btn btn-primary" id="vm-save">Salvar</button>',
      onMount: function(root) {
        root.querySelector('#vm-save').addEventListener('click', function() {
          var qtd = Math.round(parseDec(root.querySelector('#vm-qtd').value));
          var data = root.querySelector('#vm-data').value;
          var p = produtoById_(root.querySelector('#vm-produto').value);
          if (!p) { toast('Escolha o produto.', 'warn'); return; }
          if (!qtd || qtd < 1) { toast('A quantidade deve ser 1 ou mais.', 'warn'); return; }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { toast('Data inválida.', 'warn'); return; }
          v.produtoId = p.id; v.produto = p.produto; v.qtd = qtd; v.data = data;
          v.precoUnit = num(p.preco); v.comissaoUnit = num(p.comissaoVenda);
          v.obs = root.querySelector('#vm-obs').value.trim();
          ExtraStore.save();
          toast('Venda atualizada.', 'success');
          closeModal();
          renderVendas();
        });
      } }
  );
}
function excluirVenda_(id) {
  var ex = ExtraStore.load();
  var v = (ex.vendas || []).filter(function(x) { return x.id === id; })[0];
  if (!v) return;
  confirmar('Excluir o registro de <b>' + num(v.qtd) + '× ' + esc(v.produto) + '</b> em ' + fmtData(v.data) + '?', 'Excluir', function() {
    ex.vendas = ex.vendas.filter(function(x) { return x.id !== id; });
    ExtraStore.save();
    toast('Venda excluída.', 'success');
    renderVendas();
  }, true);
}
function exportVendasCSV() {
  var period = $('#vf-period').value;
  var lista = vendasPeriodo(period, state.vendasF.produto);
  if (!lista.length) { toast('Nenhuma venda no período para exportar.', 'warn'); return; }
  var linhas = [['ID', 'Data', 'Produto', 'Produto ID', 'Quantidade', 'Preço unitário', 'Total', 'Comissão unitária', 'Comissão total', 'Observações']];
  lista.forEach(function(v) {
    linhas.push([v.id, v.data, v.produto, v.produtoId, v.qtd, v.precoUnit,
      arred2(num(v.qtd) * num(v.precoUnit)), v.comissaoUnit, arred2(num(v.qtd) * num(v.comissaoUnit)), v.obs || '']);
  });
  csvDownload('soessacena-vendas-' + hojeISO() + '.csv', linhas);
  toast('Exportação de vendas gerada.', 'success');
}
function seedVendasDemo_() {
  var ex = ExtraStore.load();
  if ((ex.vendas || []).length) return;
  function d(off) {
    var x = new Date(); x.setDate(x.getDate() - off);
    return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
  }
  var rows = [
    ['PRD-0001', 'Mini Projetor Portátil', 149.9, 22.49, 1, d(1), 'Venda via vídeo fixado'],
    ['PRD-0001', 'Mini Projetor Portátil', 149.9, 22.49, 2, d(3), 'Live de sábado'],
    ['PRD-0002', 'Luminária LED Sunset', 89.9, 16.18, 1, d(2), ''],
    ['PRD-0009', 'Brinco Luminoso Neon', 29.9, 8.97, 3, d(4), 'Vitrine do perfil'],
    ['PRD-0009', 'Brinco Luminoso Neon', 29.9, 8.97, 1, d(6), '']
  ];
  ex.vendas = rows.map(function(r, i) {
    return { id: 'VND-' + String(i + 1).padStart(4, '0'), produtoId: r[0], produto: r[1],
      data: r[5], qtd: r[4], precoUnit: r[2], comissaoUnit: r[3], obs: r[6] };
  });
  ExtraStore.save();
}

/* ============================================================
   21f. RESUMO DE VENDAS DIRETAS (Dashboard + aba Vendas)
   ============================================================ */
function resumoVendasDiretas_(period) {
  var lista = vendasPeriodo(period, '');
  var un = 0, rec = 0, com = 0, mapa = {};
  lista.forEach(function(v) {
    un += num(v.qtd);
    rec += num(v.qtd) * num(v.precoUnit);
    com += num(v.qtd) * num(v.comissaoUnit);
    mapa[v.produtoId] = mapa[v.produtoId] || { nome: v.produto, un: 0, com: 0 };
    mapa[v.produtoId].un += num(v.qtd);
    mapa[v.produtoId].com += num(v.qtd) * num(v.comissaoUnit);
  });
  var porProduto = Object.keys(mapa).map(function(k) {
    var m = mapa[k];
    return { nome: m.nome, v: arred2(m.com), sub: m.un + ' un' };
  }).sort(function(a, z) { return z.v - a.v; }).slice(0, 6);
  return { lista: lista, un: un, rec: arred2(rec), com: arred2(com), porProduto: porProduto };
}
function serieVendasDia_(period) {
  var lista = vendasPeriodo(period, '');
  var pi = periodoInfo(period);
  if (pi.dias) {
    var out = [];
    for (var i = pi.dias - 1; i >= 0; i--) {
      var ds = dataMenosDias(i);
      out.push({ l: fmtData(ds).slice(0, 5), v: 0, _d: ds });
    }
    lista.forEach(function(v) {
      var d = String(v.data).slice(0, 10);
      for (var j = 0; j < out.length; j++) if (out[j]._d === d) { out[j].v += num(v.qtd); break; }
    });
    return out;
  }
  var mapa = {};
  lista.forEach(function(v) {
    var d = String(v.data).slice(0, 10);
    if (!d) return;
    mapa[d] = mapa[d] || { l: fmtData(d).slice(0, 5), v: 0 };
    mapa[d].v += num(v.qtd);
  });
  return Object.keys(mapa).sort().slice(-14).map(function(k) { return mapa[k]; });
}

/* ============================================================
   21g. LANÇAMENTO EXPRESSO — atualizar métricas dos vídeos rápido
   ============================================================ */
var expressPeriod = '30';
function conteudosExpress_(period) {
  var ini = period === 'all' ? null : dataMenosDias(parseInt(period, 10) - 1);
  return (state.data.conteudos || []).filter(function(c) {
    if (c.status === '❌ Arquivado') return false;
    var d = String(c.data || '').slice(0, 10);
    if (!d) return false;
    if (ini && d < ini) return false;
    return true;
  }).sort(function(a, b) { return a.data < b.data ? 1 : (a.data > b.data ? -1 : 0); });
}
function openExpressModal() {
  openModal('<div id="express-box"></div>', {
    title: '⚡ Lançamento expresso',
    xl: true,
    sticky: true,
    foot: '<span class="exp-count" id="exp-count"></span>' +
      '<button class="btn btn-ghost" data-close>Cancelar</button>' +
      '<button class="btn btn-primary" id="exp-save" disabled>Salvar alterações</button>',
    onMount: function() {
      renderExpressList_();
      $('#exp-save').addEventListener('click', salvarExpress_);
      updExpCount_();
    }
  });
}
function renderExpressList_() {
  var box = $('#express-box');
  var lista = conteudosExpress_(expressPeriod);
  var seg = '<div class="exp-toolbar"><span style="font-size:12px;color:var(--text-3);font-weight:600">Período:</span>' +
    '<div class="seg" id="exp-seg">' +
    ['7', '30', 'all'].map(function(p) {
      return '<button data-ep="' + p + '"' + (expressPeriod === p ? ' class="on"' : '') + '>' + (p === 'all' ? 'Tudo' : p + 'd') + '</button>';
    }).join('') + '</div>' +
    '<span class="card-hint">digite os números do TikTok — a comissão recalcula sozinha ao salvar</span></div>';
  if (!lista.length) {
    box.innerHTML = seg + '<div class="list-empty-big">Nenhum conteúdo no período. Registre um conteúdo primeiro.</div>';
    return;
  }
  box.innerHTML = seg +
    '<div class="exp-head"><span>Conteúdo</span><span>Views</span><span>Cliques</span><span>Vendas</span></div>' +
    '<div class="exp-list">' + lista.map(function(c) {
      return '<div class="exp-row" data-cid="' + esc(c.id) + '">' +
        '<div class="exp-info"><div class="exp-title">' + esc(c.titulo) + '</div>' +
        '<div class="exp-sub"><b>' + esc(c.produto) + '</b> · ' + fmtData(c.data) + ' · ' + fmtCompact(c.views) + ' views · ' + num(c.vendas) + ' vendas</div></div>' +
        '<div class="exp-fld"><input class="input sm" data-f="views" type="text" inputmode="numeric" value="' + esc(num(c.views)) + '"></div>' +
        '<div class="exp-fld"><input class="input sm" data-f="clicks" type="text" inputmode="numeric" value="' + esc(num(c.clicks)) + '"></div>' +
        '<div class="exp-fld"><input class="input sm" data-f="vendas" type="text" inputmode="numeric" value="' + esc(num(c.vendas)) + '">' +
        '<span class="exp-com" data-com></span></div>' +
      '</div>';
    }).join('') + '</div>';
  var segEl = $('#exp-seg');
  segEl.addEventListener('click', function(e) {
    var b = e.target.closest('button[data-ep]');
    if (!b) return;
    expressPeriod = b.getAttribute('data-ep');
    renderExpressList_();
    updExpCount_();
  });
  box.querySelectorAll('.exp-row input').forEach(function(inp) {
    inp.addEventListener('input', function() {
      updExpCom_(inp.closest('.exp-row'));
      updExpCount_();
    });
  });
  box.querySelectorAll('.exp-row').forEach(function(r) { updExpCom_(r); });
}
function updExpCom_(row) {
  var c = (state.data.conteudos || []).filter(function(x) { return x.id === row.getAttribute('data-cid'); })[0];
  if (!c) return;
  var p = produtoById_(c.produtoId);
  var vendas = Math.round(parseDec(row.querySelector('input[data-f="vendas"]').value));
  var el = row.querySelector('[data-com]');
  if (!el) return;
  el.textContent = (p && vendas > 0) ? '≈ ' + fmtMoeda(arred2(vendas * num(p.comissaoVenda))) : '';
}
function expMudancas_() {
  var out = [];
  $$('#express-box .exp-row').forEach(function(row) {
    var c = (state.data.conteudos || []).filter(function(x) { return x.id === row.getAttribute('data-cid'); })[0];
    if (!c) return;
    var g = function(f) { return Math.round(parseDec(row.querySelector('input[data-f="' + f + '"]').value)); };
    var views = g('views'), clicks = g('clicks'), vendas = g('vendas');
    var changed = views !== num(c.views) || clicks !== num(c.clicks) || vendas !== num(c.vendas);
    row.classList.toggle('changed', changed);
    if (changed) out.push({ c: c, views: views, clicks: clicks, vendas: vendas });
  });
  return out;
}
function updExpCount_() {
  var m = expMudancas_();
  var btn = $('#exp-save');
  if (!btn) return;
  btn.disabled = !m.length;
  $('#exp-count').textContent = m.length ? m.length + ' conteúdo(s) com alteração' : 'Nenhuma alteração';
}
function salvarExpress_() {
  var mud = expMudancas_();
  if (!mud.length) return;
  var btn = $('#exp-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin" style="display:inline-block">↻</span> Salvando…';
  var chain = Promise.resolve();
  var erros = 0;
  mud.forEach(function(m) {
    chain = chain.then(function() {
      var c = m.c;
      var payload = {
        id: c.id, produtoId: c.produtoId, data: c.data, tipo: c.tipo, gancho: c.gancho, status: c.status,
        titulo: c.titulo, url: c.url || '', views: m.views, curtidas: num(c.curtidas), comentarios: num(c.comentarios),
        compartilh: num(c.compartilh), clicks: m.clicks, carrinhos: num(c.carrinhos), pedidos: num(c.pedidos),
        vendas: m.vendas, obs: c.obs || ''
      };
      // se as vendas não mudaram, preserva a comissão manual existente
      if (m.vendas === num(c.vendas) && c.comissao !== null && c.comissao !== undefined) payload.comissao = c.comissao;
      return API.rpc('save_content', payload).then(function(r) { if (!r.ok) erros++; }).catch(function() { erros++; });
    });
  });
  chain.then(function() {
    closeModal();
    toast(mud.length + ' conteúdo(s) atualizado(s) ⚡' + (erros ? ' (' + erros + ' com erro)' : ''), erros ? 'warn' : 'success');
    carregarTudo_(false);
  });
}

/* ============================================================
   21h. CORTES — registro diário de cortes de filmes e séries
   ============================================================ */
function plataformaCorte_(url) {
  url = String(url || '');
  if (/youtube\.com|youtu\.be/i.test(url)) return { nome: '▶ YouTube', cls: 'yt' };
  if (/tiktok\.com/i.test(url)) return { nome: '♪ TikTok', cls: 'tt' };
  if (/instagram\.com/i.test(url)) return { nome: '◎ Instagram', cls: 'ig' };
  if (/facebook\.com|fb\.watch/i.test(url)) return { nome: 'f Facebook', cls: 'fb' };
  if (/kwai/i.test(url)) return { nome: 'K Kwai', cls: 'kw' };
  return { nome: '🎬 Vídeo', cls: 'outro' };
}
function renderCortes() {
  if (!state.data) return;
  var cortes = (state.data.cortes || []).slice();
  cortes.sort(function(a, b) {
    if (String(a.criadoEm) !== String(b.criadoEm)) return String(a.criadoEm) < String(b.criadoEm) ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
  var pubs = cortes.filter(function(c) { return c.publicado; });
  var mesAtual = hojeISO().slice(0, 7);
  var pubMes = pubs.filter(function(c) { return String(c.dataPublicacao || '').slice(0, 7) === mesAtual; }).length;
  $('#cortes-stats').innerHTML =
    '<div class="vd-stat"><span>Total de cortes</span><b>' + cortes.length + '</b></div>' +
    '<div class="vd-stat"><span>Publicados</span><b style="color:var(--aqua)">' + pubs.length + '</b></div>' +
    '<div class="vd-stat"><span>Pendentes</span><b style="color:var(--rosa)">' + (cortes.length - pubs.length) + '</b></div>' +
    '<div class="vd-stat"><span>Publicados no mês</span><b>' + pubMes + '</b></div>';
  $('#cortes-sub').textContent = cortes.length + ' corte(s) · ' + pubs.length + ' publicado(s)';

  var f = state.cortes.f;
  var q = normKey(state.cortes.q);
  var lista = cortes.filter(function(c) {
    if (f === 'pendentes' && c.publicado) return false;
    if (f === 'publicados' && !c.publicado) return false;
    if (q && normKey(c.titulo + ' ' + c.descricao + ' ' + c.link).indexOf(q) === -1) return false;
    return true;
  });
  if (!lista.length) {
    $('#cortes-lista').innerHTML = cortes.length
      ? '<div class="list-empty" style="margin-top:14px">Nenhum corte com esse filtro.</div>'
      : '<div class="list-empty" style="margin-top:14px">Nenhum corte registrado ainda — use o formulário acima para adicionar o primeiro. 🎬</div>';
    return;
  }
  $('#cortes-lista').innerHTML = '<div class="cortes-grid">' + lista.map(corteCardHtml_).join('') + '</div>';
}
function corteCardHtml_(c) {
  var plat = plataformaCorte_(c.link);
  var registrado = c.criadoEm ? fmtData(String(c.criadoEm).slice(0, 10)) : '—';
  var linkCurto = String(c.link || '').replace(/^https?:\/\/(www\.)?/i, '');
  if (linkCurto.length > 44) linkCurto = linkCurto.slice(0, 44) + '…';
  return '<div class="corte-card' + (c.publicado ? ' pub' : '') + '" data-id="' + esc(c.id) + '">' +
    '<div class="corte-top">' +
      '<span class="corte-plat ' + plat.cls + '">' + esc(plat.nome) + '</span>' +
      '<span class="corte-when">registrado em ' + registrado + '</span>' +
    '</div>' +
    '<div class="corte-titulo">' + esc(c.titulo) + '</div>' +
    (c.descricao ? '<div class="corte-desc">' + esc(c.descricao).replace(/\n/g, '<br>') + '</div>' : '') +
    '<div class="corte-foot">' +
      '<a class="corte-link" href="' + esc(c.link) + '" target="_blank" rel="noopener" title="' + esc(c.link) + '">' + ICONS.link + '<span>' + esc(linkCurto) + '</span></a>' +
      (c.publicado
        ? '<span class="corte-status ok">✅ Publicado em <b>' + fmtData(c.dataPublicacao) + '</b></span>'
        : '<span class="corte-status pend">📤 Ainda não publicado</span>') +
      '<span class="corte-acts">' +
        (c.publicado
          ? '<button class="btn btn-ghost sm" data-act="despublicar-corte" title="Voltar para pendente">↩️ Pendente</button>'
          : '<button class="btn btn-primary sm" data-act="publicar-corte" title="Marcar como publicado">✅ Publicado?</button>') +
        '<button class="icon-btn" data-act="editar-corte" title="Editar">' + ICONS.edit + '</button>' +
        '<button class="icon-btn" data-act="excluir-corte" title="Excluir">' + ICONS.trash + '</button>' +
      '</span>' +
    '</div>' +
  '</div>';
}
function marcarErroCorte_(campo, msg) {
  var fld = $('#fld-ct-' + campo);
  if (!fld) return;
  fld.classList.add('err');
  var fe = fld.querySelector('.ferr');
  if (fe) fe.textContent = msg;
  setTimeout(function() { fld.classList.remove('err'); }, 1400);
}
function adicionarCorte_() {
  var link = $('#ct-link').value.trim();
  var titulo = $('#ct-titulo').value.trim();
  var desc = $('#ct-desc').value.trim();
  var errou = false;
  if (!titulo) { marcarErroCorte_('titulo', 'Título é obrigatório.'); errou = true; }
  if (!link) { marcarErroCorte_('link', 'Cole o link do vídeo.'); errou = true; }
  else if (!/^https?:\/\//i.test(link)) { marcarErroCorte_('link', 'O link deve começar com https://'); errou = true; }
  if (errou) return;
  API.rpc('save_corte', { link: link, titulo: titulo, descricao: desc, publicado: false }).then(function(r) {
    if (!r.ok) throw new Error(r.message);
    toast(r.message + ' (ID ' + r.id + ')', 'success');
    $('#ct-link').value = ''; $('#ct-titulo').value = ''; $('#ct-desc').value = '';
    $('#ct-link').focus();
    return carregarTudo_(false);
  }).catch(function(e) { toast(e.message, 'error'); });
}
function publicarCorteModal_(c) {
  openModal(
    '<div class="field"><label>Data da publicação</label>' +
    '<input class="input" type="date" id="pub-data" value="' + hojeISO() + '"></div>' +
    '<p class="modal-hint">Depois você pode editar a data ou marcar como pendente de novo.</p>',
    {
      title: 'Publicar "' + c.titulo + '"',
      foot: '<button class="btn btn-ghost" data-close>Cancelar</button>' +
            '<button class="btn btn-primary" id="pub-ok">✅ Confirmar publicação</button>',
      onMount: function() {
        $('#pub-data').focus();
        $('#pub-ok').addEventListener('click', function() {
          var d = $('#pub-data').value;
          if (!d) { toast('Escolha a data de publicação.', 'warn'); return; }
          API.rpc('save_corte', {
            id: c.id, link: c.link, titulo: c.titulo, descricao: c.descricao,
            publicado: true, dataPublicacao: d
          }).then(function(r) {
            if (!r.ok) throw new Error(r.message);
            toast('Corte marcado como publicado! 🎉', 'success');
            closeModal();
            carregarTudo_(false);
          }).catch(function(e) { toast(e.message, 'error'); });
        });
      }
    }
  );
}
function despublicarCorte_(c) {
  API.rpc('save_corte', {
    id: c.id, link: c.link, titulo: c.titulo, descricao: c.descricao,
    publicado: false, dataPublicacao: null
  }).then(function(r) {
    if (!r.ok) throw new Error(r.message);
    toast('Corte voltou para pendente.', 'success');
    carregarTudo_(false);
  }).catch(function(e) { toast(e.message, 'error'); });
}
function editarCorteModal_(c) {
  openModal(
    '<div class="field" id="fld-ce-link"><label>Link do vídeo <i class="req">*</i></label>' +
      '<input class="input" id="ce-link" type="url" value="' + esc(c.link) + '"><span class="ferr"></span></div>' +
    '<div class="field" id="fld-ce-titulo"><label>Título <i class="req">*</i></label>' +
      '<input class="input" id="ce-titulo" type="text" value="' + esc(c.titulo) + '"><span class="ferr"></span></div>' +
    '<div class="field"><label>Descrição</label>' +
      '<textarea class="input" id="ce-desc" rows="3">' + esc(c.descricao || '') + '</textarea></div>' +
    '<div class="field ce-pub-row">' +
      '<label class="chk"><input class="input" type="checkbox" id="ce-pub"' + (c.publicado ? ' checked' : '') + '> Já foi publicado</label>' +
      '<input class="input" type="date" id="ce-data" value="' + esc(c.dataPublicacao || hojeISO()) + '"' + (c.publicado ? '' : ' disabled') + '>' +
    '</div>',
    {
      title: 'Editar corte ' + c.id,
      foot: '<button class="btn btn-ghost" data-close>Cancelar</button>' +
            '<button class="btn btn-primary" id="ce-save">Salvar alterações</button>',
      onMount: function(root) {
        var chk = root.querySelector('#ce-pub');
        var dt = root.querySelector('#ce-data');
        chk.addEventListener('change', function() { dt.disabled = !chk.checked; });
        root.querySelector('#ce-save').addEventListener('click', function() {
          var link = root.querySelector('#ce-link').value.trim();
          var titulo = root.querySelector('#ce-titulo').value.trim();
          var pub = chk.checked;
          var data = dt.value;
          var okFlag = true;
          if (!titulo) {
            var f1 = root.querySelector('#fld-ce-titulo'); f1.classList.add('err');
            f1.querySelector('.ferr').textContent = 'Título é obrigatório.'; okFlag = false;
          }
          if (!link || !/^https?:\/\//i.test(link)) {
            var f2 = root.querySelector('#fld-ce-link'); f2.classList.add('err');
            f2.querySelector('.ferr').textContent = 'Link inválido (use https://).'; okFlag = false;
          }
          if (pub && !data) { toast('Informe a data de publicação.', 'warn'); okFlag = false; }
          if (!okFlag) return;
          API.rpc('save_corte', {
            id: c.id, link: link, titulo: titulo,
            descricao: root.querySelector('#ce-desc').value.trim(),
            publicado: pub, dataPublicacao: pub ? data : null
          }).then(function(r) {
            if (!r.ok) throw new Error(r.message);
            toast(r.message, 'success');
            closeModal();
            carregarTudo_(false);
          }).catch(function(e) { toast(e.message, 'error'); });
        });
      }
    }
  );
}
function excluirCorte_(c) {
  confirmar('Excluir o corte <b>"' + esc(c.titulo) + '"</b>?<br><small style="color:var(--text-3)">Essa ação remove o registro definitivamente.</small>',
    'Excluir', function() {
      API.rpc('remove_corte', c.id).then(function(r) {
        if (!r.ok) throw new Error(r.message);
        toast(r.message, 'success');
        carregarTudo_(false);
      }).catch(function(e) { toast(e.message, 'error'); });
    }, true);
}

/* ============================================================
   22. NAVEGAÇÃO
   ============================================================ */
function showView(v) {
  currentView = v;
  $$('.nav-item').forEach(function(n) { n.classList.toggle('active', n.getAttribute('data-view') === v); });
  $$('.view').forEach(function(s) { s.classList.toggle('active', s.id === 'view-' + v); });
  var sb = $('#sidebar');
  sb.classList.remove('open');
  $('#overlay').classList.add('hidden');
  if (state.data || v === 'agenda') {
    if (v === 'dashboard') renderDashboard();
    else if (v === 'esteira') renderEsteira();
    else if (v === 'cadastro') renderCadastro();
    else if (v === 'conteudos') renderConteudos();
    else if (v === 'cortes') renderCortes();
    else if (v === 'vendas') renderVendas();
    else if (v === 'agenda') renderAgenda();
    else if (v === 'relatorios') renderRelatorios();
    else if (v === 'config') renderConfig();
  }
}

/* ============================================================
   23. CARREGAMENTO
   ============================================================ */
function carregarTudo_(mostrarSplash) {
  if (state.loading) return Promise.resolve();
  loading_(true);
  return API.rpc('get_bundle').then(function(b) {
    if (!b || b.ok !== true) throw new Error((b && b.message) || 'Resposta inválida do servidor.');
    state.data = b;
    state.installed = !!b.installed;
    if (!state.installed) {
      mostrarErro_('setup');
      return;
    }
    preencherSelects_();
    mostrarApp_();
    showView(currentView);
    atualizarSyncTs_(b.syncTs);
  }).catch(function(e) {
    if (e && e.message && e.message.indexOf('não configurado') > -1) mostrarErro_('setup');
    else mostrarErro_('erro', e.message);
  }).then(function() { loading_(false); });
}
function preencherSelects_() {
  var L = state.data.listas || {};
  function fill(el, itens, ph) {
    var cur = el.value;
    opcoesSelect_(el, itens, ph, cur);
  }
  fill($('#f-categoria'), L.categorias || [], 'Todas as categorias');
  fill($('#f-status'), L.status_produto || [], 'Todos os status');
  fill($('#ef-status'), L.status_produto || [], 'Status: todos');
  fill($('#ef-classif'), L.classificacoes || [], 'Classificação: todas');
  fill($('#ef-categoria'), L.categorias || [], 'Categoria: todas');
  fill($('#ef-prioridade'), L.prioridades || [], 'Prioridade: todas');
  fill($('#cf-categoria'), L.categorias || [], 'Categoria: todas');
  fill($('#cf-status'), L.status_produto || [], 'Status: todos');
  fill($('#cf-prioridade'), L.prioridades || [], 'Prioridade: todas');
  var prods = (state.data.produtos || []).map(function(p) { return p.id; });
  fill($('#nf-produto'), prods, 'Produto: todos');
  fill($('#nf-categoria'), L.categorias || [], 'Categoria: todas');
  fill($('#nf-status'), L.status_conteudo || [], 'Status: todos');
  fill($('#nf-tipo'), L.tipos_conteudo || [], 'Tipo: todos');
  // rótulos de produto no filtro de conteúdos
  $('#nf-produto').querySelectorAll('option').forEach(function(o) {
    var p = (state.data.produtos || []).filter(function(x) { return x.id === o.value; })[0];
    if (p) o.textContent = p.produto;
  });
}
function mostrarApp_() {
  $('#setup-screen').classList.add('hidden');
  $('#error-screen').classList.add('hidden');
  var sp = $('#splash');
  if (sp) sp.classList.add('hidden');
  var app = $('#app');
  app.classList.remove('hidden');
  requestAnimationFrame(function() { app.classList.add('show'); });
  var nome = (state.data.config || {}).nomeOperacao || 'SóEssaCena';
  $('.brand-txt strong').textContent = nome;
  document.title = nome + ' | TikTok Shop';
}
function mostrarErro_(tipo, msg) {
  var app = $('#app');
  app.classList.add('hidden'); app.classList.remove('show');
  var sp = $('#splash');
  if (sp) sp.classList.add('hidden');
  $('#setup-screen').classList.toggle('hidden', tipo !== 'setup');
  $('#error-screen').classList.toggle('hidden', tipo !== 'erro');
  if (tipo === 'erro') $('#error-msg').textContent = msg || 'Não foi possível carregar os dados.';
  if (tipo === 'setup') {
    var card = document.querySelector('#setup-screen .setup-card');
    if (card) {
      var hint = card.querySelector('#setup-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'setup-hint';
        var actions = card.querySelector('.setup-actions');
        card.insertBefore(hint, actions);
      }
      var semSupa = (typeof SUPABASE_URL === 'undefined') || !SUPABASE_URL;
      hint.innerHTML = '<b>💡 Testando no seu computador?</b> Abra <code>web/config.js</code> e mude <code>LOCAL_MODE</code> para <b>true</b> (salve e recarregue a página) — assim tudo roda e fica salvo no navegador, sem precisar de Supabase. No site publicado, este aviso só some depois de configurar o Supabase.' +
        (semSupa ? '' : '<br><br>⚠️ A URL do Supabase já está preenchida — confira se ela está correta, se o <code>schema.sql</code> foi executado e se a chave <b>anon</b> é a mesma.');
    }
  }
}
function atualizarSyncTs_(ts) {
  var st = $('#sync-status');
  st.className = 'sync-dot ok';
  $('#sync-ts').textContent = 'Sincronizado ' + fmtDataHora(ts);
}

/* ============================================================
   24. EVENTOS
   ============================================================ */
var _eventsBound_ = false;
function bindEvents_() {
  if (_eventsBound_) return; _eventsBound_ = true;
  // navegação
  $$('.nav-item').forEach(function(n) {
    n.addEventListener('click', function(e) {
      e.preventDefault();
      showView(n.getAttribute('data-view'));
    });
  });
  $$('.link-btn[data-goto]').forEach(function(b) {
    b.addEventListener('click', function() { showView(b.getAttribute('data-goto')); });
  });
  // menu mobile
  $('#btn-menu').addEventListener('click', function() {
    $('#sidebar').classList.add('open');
    $('#overlay').classList.remove('hidden');
  });
  $('#overlay').addEventListener('click', function() {
    $('#sidebar').classList.remove('open');
    $('#overlay').classList.add('hidden');
  });
  // sincronizar
  function sync() { carregarTudo_(false); }
  $('#btn-sync').addEventListener('click', sync);
  $('#btn-sync-top').addEventListener('click', sync);
  $('#btn-recheck').addEventListener('click', function() {
    $('#setup-screen').classList.add('hidden');
    var s = document.createElement('div');
    s.className = 'splash'; s.id = 'splash';
    document.body.appendChild(s);
    carregarTudo_(true);
  });
  $('#btn-retry').addEventListener('click', function() {
    $('#error-screen').classList.add('hidden');
    carregarTudo_(true);
  });
  // ações globais por atributo (delegação)
  document.addEventListener('click', function(e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    if (act === 'new-product') openProdutoModal(null);
    else if (act === 'new-content') openConteudoModal(null);
    else if (act === 'edit-product') {
      var p = (state.data.produtos || []).filter(function(x) { return x.id === id; })[0];
      if (p) openProdutoModal(p);
    }
    else if (act === 'edit-content') {
      var c = (state.data.conteudos || []).filter(function(x) { return x.id === id; })[0];
      if (c) openConteudoModal(c);
    }
    else if (act === 'archive-product') arquivarProduto_(id);
    else if (act === 'archive-content') arquivarConteudo_(id);
    else if (act === 'play-video') {
      var c2 = (state.data.conteudos || []).filter(function(x) { return x.id === id; })[0];
      if (c2) openVideoPlayer(c2);
    }
    else if (act === 'open-gallery') {
      var p2 = (state.data.produtos || []).filter(function(x) { return x.id === id; })[0];
      if (p2) openProductGallery(p2);
    }
    else if (act === 'new-task') abrirModalTarefa({ data: state.agenda.sel || hojeISO() });
    else if (act === 'edit-venda') {
      var v3 = (ExtraStore.load().vendas || []).filter(function(x) { return x.id === id; })[0];
      if (v3) abrirModalVenda(v3);
    }
    else if (act === 'del-venda') excluirVenda_(id);
  });
  // dashboard
  $('#seg-period').addEventListener('click', function(e) {
    var b = e.target.closest('button[data-p]');
    if (!b) return;
    state.period = b.getAttribute('data-p');
    $$('#seg-period button').forEach(function(x) { x.classList.toggle('on', x === b); });
    renderDashboard();
  });
  $('#f-categoria').addEventListener('change', function() { state.dashF.categoria = this.value; renderDashboard(); });
  $('#f-status').addEventListener('change', function() { state.dashF.status = this.value; renderDashboard(); });
  // esteira
  $('#seg-esteira').addEventListener('click', function(e) {
    var b = e.target.closest('button[data-m]');
    if (!b) return;
    state.esteira.modo = b.getAttribute('data-m');
    $$('#seg-esteira button').forEach(function(x) { x.classList.toggle('on', x === b); });
    renderEsteira();
  });
  $('#ef-search').addEventListener('input', debounce(function() { state.esteira.f.q = this.value; renderEsteira(); }, 180));
  $('#ef-status').addEventListener('change', function() { state.esteira.f.status = this.value; renderEsteira(); });
  $('#ef-classif').addEventListener('change', function() { state.esteira.f.classif = this.value; renderEsteira(); });
  $('#ef-categoria').addEventListener('change', function() { state.esteira.f.cat = this.value; renderEsteira(); });
  $('#ef-prioridade').addEventListener('change', function() { state.esteira.f.prio = this.value; renderEsteira(); });
  // cadastro
  $('#cf-search').addEventListener('input', debounce(function() { state.cadastro.f.q = this.value; renderCadastro(); }, 180));
  $('#cf-categoria').addEventListener('change', function() { state.cadastro.f.cat = this.value; renderCadastro(); });
  $('#cf-status').addEventListener('change', function() { state.cadastro.f.status = this.value; renderCadastro(); });
  $('#cf-prioridade').addEventListener('change', function() { state.cadastro.f.prio = this.value; renderCadastro(); });
  // conteúdos
  $('#nf-search').addEventListener('input', debounce(function() { state.conteudos.f.q = this.value; renderConteudos(); }, 180));
  $('#nf-produto').addEventListener('change', function() { state.conteudos.f.produto = this.value; renderConteudos(); });
  $('#nf-categoria').addEventListener('change', function() { state.conteudos.f.cat = this.value; renderConteudos(); });
  $('#nf-status').addEventListener('change', function() { state.conteudos.f.status = this.value; renderConteudos(); });
  $('#nf-tipo').addEventListener('change', function() { state.conteudos.f.tipo = this.value; renderConteudos(); });
  $('#nf-period').addEventListener('change', function() { state.conteudos.f.period = this.value; renderConteudos(); });
  $$('#conteudos-table thead th[data-sort]').forEach(function(th) {
    th.addEventListener('click', function() {
      var k = th.getAttribute('data-sort');
      if (state.conteudos.sort.key === k) state.conteudos.sort.dir *= -1;
      else state.conteudos.sort = { key: k, dir: -1 };
      renderConteudos();
    });
  });
  // conteúdos: lançamento expresso
  $('#btn-express').addEventListener('click', openExpressModal);
  // cortes (filmes & séries)
  $('#ct-add').addEventListener('click', adicionarCorte_);
  ['#ct-link', '#ct-titulo'].forEach(function(sel) {
    $(sel).addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); adicionarCorte_(); } });
  });
  $('#ct-search').addEventListener('input', debounce(function() { state.cortes.q = this.value; renderCortes(); }, 180));
  $('#ct-chips').addEventListener('click', function(e) {
    var b = e.target.closest('.cchip');
    if (!b) return;
    state.cortes.f = b.getAttribute('data-f');
    $$('#ct-chips .cchip').forEach(function(x) { x.classList.toggle('active', x === b); });
    renderCortes();
  });
  $('#cortes-lista').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = e.target.closest('.corte-card');
    if (!card) return;
    var id = card.getAttribute('data-id');
    var c = (state.data.cortes || []).filter(function(x) { return x.id === id; })[0];
    if (!c) return;
    var act = btn.getAttribute('data-act');
    if (act === 'publicar-corte') publicarCorteModal_(c);
    else if (act === 'despublicar-corte') despublicarCorte_(c);
    else if (act === 'editar-corte') editarCorteModal_(c);
    else if (act === 'excluir-corte') excluirCorte_(c);
  });
  $('#conteudos-porproduto').addEventListener('click', function(e) {
    var chip = e.target.closest('.pp-chip');
    if (!chip) return;
    var pid = chip.getAttribute('data-pid');
    var sel = $('#nf-produto');
    sel.value = (sel.value === pid) ? '' : pid;
    state.conteudos.f.produto = sel.value;
    renderConteudos();
  });
  // vendas
  $('#vf-period').addEventListener('change', renderVendas);
  $('#vf-produto').addEventListener('change', function() { state.vendasF.produto = this.value; renderVendas(); });
  $('#vq-add').addEventListener('click', registrarVendaQuick_);
  $('#vq-produto').addEventListener('change', atualizarHintVendaQuick_);
  $('#vq-qtd').addEventListener('input', atualizarHintVendaQuick_);
  $('#btn-export-vendas').addEventListener('click', exportVendasCSV);
  // relatórios
  $('#rf-period').addEventListener('change', renderRelatorios);
  $('#btn-export-produtos').addEventListener('click', function() { exportProdutosCSV($('#rf-period').value); });
  $('#btn-export-conteudos').addEventListener('click', function() { exportConteudosCSV($('#rf-period').value); });
  // demo / reset local
  $('#btn-demo-data').addEventListener('click', function() {
    confirmar('Carregar os <b>dados de demonstração</b> (10 produtos, 15 conteúdos)?<br><small style="color:var(--text-3)">Se já houver produtos, a operação aborta — nada é duplicado nem apagado.</small>',
      'Carregar demo', function() {
        API.rpc('popular_dados_demo').then(function(r) {
          if (!r.ok) throw new Error(r.message);
          seedVendasDemo_();
          toast(r.message, 'success');
          carregarTudo_(false);
        }).catch(function(e) { toast(e.message, 'error'); });
      });
  });
  if (!LOCAL_MODE_) {
    var rb = $('#btn-local-reset');
    if (rb) rb.classList.add('hidden');
  } else {
    $('#btn-local-reset').addEventListener('click', function() {
      confirmar('Apagar <b>todos os dados locais</b> deste navegador (produtos, conteúdos, agenda e perfil) e recomeçar do zero?', 'Apagar tudo', function() {
        localStorage.removeItem('ssc_localdb_v1');
        localStorage.removeItem('ssc_extra_v1');
        location.reload();
      }, true);
    });
  }
  // config
  $('#btn-save-config').addEventListener('click', salvarConfig_);
  // editor de listas (configuração)
  $('#btn-save-listas').addEventListener('click', salvarListas_);
  $('#cfg-listas').addEventListener('click', function(e) {
    var del = e.target.closest('[data-del]');
    if (del) {
      var row = del.closest('.lista-item');
      if (row) row.remove();
      return;
    }
    var add = e.target.closest('[data-add]');
    if (add) {
      var cont = add.closest('.lista-ed').querySelector('.lista-ed-itens');
      var div = document.createElement('div');
      div.className = 'lista-item';
      div.innerHTML = '<input class="input" type="text" maxlength="60" placeholder="Novo item…">' +
        '<button class="icon-btn" data-del title="Remover este item">' + ICONS.trash + '</button>';
      cont.appendChild(div);
      div.querySelector('input').focus();
    }
  });
  $('#cfg-listas').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); salvarListas_(); }
  });
  $('#btn-save-perfil').addEventListener('click', salvarPerfilTikTok_);
  bindAgendaEvents_();
  $('#btn-diagnostico').addEventListener('click', rodarDiagnostico_);
  $('#btn-refresh-logs').addEventListener('click', function() {
    API.rpc('get_bundle').then(function(b) { state.data = b; renderLogs_(b.logs || []); toast('Logs atualizados.', 'success'); });
  });
  // data no topo
  var agora = new Date();
  $('#topbar-date').textContent = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  bindSearch_();
}

/* ============================================================
   25. BOOT
   ============================================================ */
window.__SSC_BOOTED = false;
document.addEventListener('DOMContentLoaded', function() {
  if (!window.google) { /* fora do Apps Script também funciona — nada a verificar */ }
  bindEvents_();
  var t0 = Date.now();
  carregarTudo_(true).then(function() {
    var rest = 1100 - (Date.now() - t0);
    setTimeout(function() {
      window.__SSC_BOOTED = true;
      var s = $('#splash');
      if (s) { s.classList.add('leaving'); setTimeout(function() { s.remove(); }, 560); }
    }, rest > 0 ? rest : 0);
  }).catch(function() {
    var rest = 1100 - (Date.now() - t0);
    setTimeout(function() {
      window.__SSC_BOOTED = true;
      var s = $('#splash');
      if (s) { s.classList.add('leaving'); setTimeout(function() { s.remove(); }, 560); }
    }, rest > 0 ? rest : 0);
  });
});
