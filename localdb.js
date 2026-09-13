/* ============================================================
   SÓESSACENA | TIKTOK SHOP — localdb.js (MODO LOCAL)
   Espelha a API do Supabase (mesmas funções, mesmas validações,
   mesmas mensagens) usando apenas o localStorage do navegador.
   Ative em config.js:  const LOCAL_MODE = true;
   Sem rede, sem instalação — tudo fica salvo no seu navegador.
   ============================================================ */
'use strict';

var LOCALDB = {
  KEY: 'ssc_localdb_v1',

  /* ---------- persistência ---------- */
  _load: function() {
    try {
      var raw = localStorage.getItem(this.KEY);
      if (raw) {
        this.state = JSON.parse(raw);
        if (!Array.isArray(this.state.cortes)) this.state.cortes = []; // migra bases antigas
        return;
      }
    } catch (e) { /* corrompido → recria */ }
    this.state = this._seed();
    this._save();
  },
  _save: function() {
    localStorage.setItem(this.KEY, JSON.stringify(this.state));
  },
  _seed: function() {
    return {
      produtos: [],
      conteudos: [],
      listas: {
        categorias: ['Casa & Organização', 'Cozinha', 'Tecnologia & Gadgets', 'Celulares & Acessórios',
          'Escritório & Setup', 'Beleza & Cuidados', 'Moda & Acessórios', 'Fitness & Esporte',
          'Automotivo', 'Pets', 'Bebês & Crianças', 'Ferramentas & Utilidades',
          'Iluminação', 'Achados & Curiosidades', 'Outro'],
        prioridades: ['🔥 Alta', '🟡 Média', '⚪ Baixa'],
        ganchos: ['Curiosidade', 'Problema → Solução', 'Demonstração', 'Antes & Depois', 'Teste Real',
          'Review / Opinião', 'Surpresa', 'Comparação', 'Economia / Oferta', 'Erro Comum',
          'Lista / Top 3', 'Storytelling', 'Desafio', 'Opinião forte', 'Outro'],
        status_produto: ['🆕 Novo', '🔎 Em análise', '📋 Aprovado para teste', '🛒 Produto solicitado',
          '📦 Aguardando produto', '🎬 Em produção', '📤 Conteúdo publicado', '🧪 Em teste',
          '🔁 Retestar', '📈 Escalando', '⏸️ Pausado', '❌ Descartado'],
        classificacoes: ['🟢 CAMPEÃO', '🔵 PROMISSOR', '🟡 EM TESTE', '🟠 REPOSICIONAR', '🔴 FRACO', '⚫ DESCARTADO'],
        tipos_conteudo: ['Entretenimento', 'Achado', 'Curiosidade', 'Problema → Solução', 'Demonstração',
          'Teste', 'Review', 'Comparação', 'Oferta', 'Lista', 'Storytelling', 'Outro'],
        status_conteudo: ['💡 Ideia', '📝 Roteiro', '🎬 Em produção', '✂️ Em edição', '⏰ Agendado',
          '📤 Publicado', '📊 Em análise', '🏆 Vencedor', '❌ Arquivado']
      },
      config: {
        nomeOperacao: 'SóEssaCena', nomeUsuario: '', metaComissao: 5000, metaVendas: 200, metaConteudos: 30,
        tema: 'dark', urlWebApp: '', instaladoEm: 'local',
        regras: { videosSemVenda: 3, vendasPromissor: 3, vendasCampeao: 10, crescimentoPct: 50 }
      },
      cortes: [],
      logs: []
    };
  },

  /* ---------- utilidades (mesmas regras do SQL) ---------- */
  _hojeISO: function() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  _ts: function() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  },
  _num: function(v) { var n = Number(v); return isFinite(n) ? n : 0; },
  _numOrNull: function(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/\./g, '').replace(',', '.');
    if (s === '') return null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  },
  _round2: function(v) { return Math.round(this._num(v) * 100) / 100; },
  _log: function(acao, entidade, id, desc) {
    this.state.logs.unshift({ data: this._ts(), usuario: 'Local (navegador)', acao: acao, entidade: entidade, id: id, descricao: desc });
    if (this.state.logs.length > 200) this.state.logs.length = 200;
  },
  _proximoId: function(prefixo) {
    var tabela = prefixo === 'PRD' ? 'produtos' : (prefixo === 'CRT' ? 'cortes' : 'conteudos');
    var max = 0;
    this.state[tabela].forEach(function(r) {
      var m = String(r.id).match(/(\d+)$/);
      if (m && Number(m[1]) > max) max = Number(m[1]);
    });
    return prefixo + '-' + String(max + 1).padStart(4, '0');
  },
  _recalcProduto: function(pid) {
    var p = null;
    this.state.produtos.forEach(function(x) { if (x.id === pid) p = x; });
    if (!p) return;
    var videos = 0, vendas = 0, comissao = 0;
    this.state.conteudos.forEach(function(c) {
      if (c.produtoId !== pid || c.status === '❌ Arquivado') return;
      videos++; vendas += LOCALDB._num(c.vendas); comissao += LOCALDB._num(c.comissao);
    });
    p.videos = videos; p.vendas = vendas; p.comissaoTotal = LOCALDB._round2(comissao);
    p.atualizadoEm = LOCALDB._ts();
  },
  _emLista: function(tipo, item) {
    return (this.state.listas[tipo] || []).indexOf(item) > -1;
  },

  /* ---------- respostas no formato do bundle ---------- */
  _bundle: function() {
    var pMapa = {};
    this.state.produtos.forEach(function(p) { pMapa[p.id] = p; });
    var conteudos = this.state.conteudos.map(function(c) {
      var p = pMapa[c.produtoId] || {};
      return {
        id: c.id, produtoId: c.produtoId, produto: p.produto || '', categoria: p.categoria || '',
        data: c.data, tipo: c.tipo, gancho: c.gancho, titulo: c.titulo, url: c.url,
        status: c.status, views: c.views, curtidas: c.curtidas, comentarios: c.comentarios,
        compartilh: c.compartilh, clicks: c.clicks, carrinhos: c.carrinhos, pedidos: c.pedidos,
        vendas: c.vendas, comissao: c.comissao, obs: c.obs
      };
    }).sort(function(a, b) {
      if (a.data !== b.data) return a.data < b.data ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    return {
      ok: true,
      installed: true,
      produtos: this.state.produtos.slice(),
      conteudos: conteudos,
      cortes: this.state.cortes.slice().sort(function(a, b) {
        if (String(a.criadoEm) !== String(b.criadoEm)) return String(a.criadoEm) < String(b.criadoEm) ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      }),
      listas: this.state.listas,
      config: this.state.config,
      logs: this.state.logs.slice(0, 30),
      syncTs: this._ts()
    };
  },

  reset: function() {
    localStorage.removeItem(this.KEY);
    this.state = this._seed();
    this._save();
  },

  /* ============================================================
     API — mesma interface das funções RPC do Supabase
     ============================================================ */
  rpc: function(fn, args) {
    var self = this;
    if (!this.state) this._load();
    var res;
    switch (fn) {
      case 'get_bundle': res = this._bundle(); break;
      case 'save_product': res = this._saveProduct(args); break;
      case 'update_product_status': res = this._updateStatus(args.p_id, args.p_status); break;
      case 'move_product_column': res = this._moveColumn(args.p_id, args.p_coluna); break;
      case 'remove_product': res = this._removeProduct(args); break;
      case 'delete_product': res = this._deleteProduct(args); break;
      case 'save_content': res = this._saveContent(args); break;
      case 'remove_content': res = this._removeContent(args); break;
      case 'save_corte': res = this._saveCorte(args); break;
      case 'remove_corte': res = this._removeCorte(args); break;
      case 'save_config': res = this._saveConfig(args); break;
      case 'save_listas': res = this._saveListas(args); break;
      case 'diagnostico_sistema': res = this._diagnostico(); break;
      case 'popular_dados_demo': res = this._demo(); break;
      default: res = { ok: false, message: 'Função desconhecida: ' + fn };
    }
    this._save();
    // imita a latência mínima de rede (UX de carregamento)
    return new Promise(function(r) { setTimeout(function() { r(res); }, 60); });
  },

  /* ---------- save_product ---------- */
  _saveProduct: function(p) {
    var err = {};
    var prod = String(p.produto || '').trim();
    var cat = String(p.categoria || '');
    var preco = this._numOrNull(p.preco);
    var pct = this._numOrNull(p.comissaoPct);
    var st = String(p.status || '').trim() || '🆕 Novo';
    var cl = String(p.classificacao || '').trim() || '🟡 EM TESTE';

    if (prod === '') err.produto = 'Nome do produto é obrigatório.';
    if (cat === '') err.categoria = 'Escolha a categoria.';
    else if (!this._emLista('categorias', cat)) err.categoria = 'Categoria não está na lista.';
    if (preco === null || preco <= 0) err.preco = 'Preço deve ser maior que zero.';
    if (pct === null || pct < 0 || pct > 100) err.comissaoPct = 'Comissão deve estar entre 0 e 100.';
    if (!this._emLista('status_produto', st)) err.status = 'Status inválido.';
    if (!this._emLista('classificacoes', cl)) err.classificacao = 'Classificação inválida.';
    if (Object.keys(err).length) return { ok: false, campos: err, message: 'Verifique os campos destacados.' };

    var id = String(p.id || '').trim();
    if (id) {
      var alvo = null;
      this.state.produtos.forEach(function(x) { if (x.id === id) alvo = x; });
      if (!alvo) return { ok: false, message: 'Produto não encontrado.' };
      alvo.produto = prod; alvo.categoria = cat; alvo.preco = preco; alvo.comissaoPct = pct;
      alvo.comissaoVenda = this._round2(preco * pct / 100);
      alvo.link = String(p.link || ''); alvo.loja = String(p.loja || '');
      alvo.prioridade = String(p.prioridade || '').trim() || '⚪ Baixa';
      alvo.gancho = String(p.gancho || ''); alvo.status = st; alvo.classificacao = cl;
      alvo.obs = String(p.obs || ''); alvo.atualizadoEm = this._ts();
      this._log('UPDATE', 'Produto', id, 'Produto atualizado: ' + prod);
      return { ok: true, id: id, message: 'Produto atualizado com sucesso.', classificacao: cl };
    }
    id = this._proximoId('PRD');
    this.state.produtos.push({
      id: id, produto: prod, categoria: cat, preco: preco, comissaoPct: pct,
      comissaoVenda: this._round2(preco * pct / 100),
      link: String(p.link || ''), loja: String(p.loja || ''),
      prioridade: String(p.prioridade || '').trim() || '⚪ Baixa',
      gancho: String(p.gancho || ''), status: st, classificacao: cl,
      videos: 0, vendas: 0, comissaoTotal: 0,
      dataCadastro: this._hojeISO(), atualizadoEm: this._ts(), obs: String(p.obs || '')
    });
    this._log('CREATE', 'Produto', id, 'Produto cadastrado: ' + prod);
    return { ok: true, id: id, message: 'Produto cadastrado com sucesso.', classificacao: cl };
  },

  /* ---------- status / kanban / arquivar ---------- */
  _updateStatus: function(id, st) {
    if (!this._emLista('status_produto', st)) return { ok: false, message: 'Status inválido.' };
    var p = null;
    this.state.produtos.forEach(function(x) { if (x.id === id) p = x; });
    if (!p) return { ok: false, message: 'Produto não encontrado.' };
    p.status = st; p.atualizadoEm = this._ts();
    this._log('UPDATE', 'Produto', id, 'Status alterado para ' + st);
    return { ok: true, message: 'Status atualizado.', status: st, classificacao: p.classificacao };
  },
  _moveColumn: function(id, coluna) {
    var MAP = {
      novo: { st: '🆕 Novo', cl: null, rot: 'Novo' },
      analise: { st: '🔎 Em análise', cl: null, rot: 'Em análise' },
      aprovado: { st: '📋 Aprovado para teste', cl: null, rot: 'Aprovado' },
      producao: { st: '🎬 Em produção', cl: null, rot: 'Produção' },
      teste: { st: '🧪 Em teste', cl: null, rot: 'Em teste' },
      escalando: { st: '📈 Escalando', cl: null, rot: 'Escalando' },
      campeoes: { st: '📈 Escalando', cl: '🟢 CAMPEÃO', rot: 'Campeões' },
      descartados: { st: '❌ Descartado', cl: '⚫ DESCARTADO', rot: 'Descartados' }
    };
    var m = MAP[coluna];
    if (!m) return { ok: false, message: 'Coluna inválida.' };
    var p = null;
    this.state.produtos.forEach(function(x) { if (x.id === id) p = x; });
    if (!p) return { ok: false, message: 'Produto não encontrado.' };
    p.status = m.st;
    if (m.cl) p.classificacao = m.cl;
    p.atualizadoEm = this._ts();
    this._log('MOVE', 'Produto', id, 'Movido para "' + m.rot + '" (status: ' + m.st + ').');
    return { ok: true, message: 'Movido para ' + m.rot + '.', status: p.status, classificacao: p.classificacao };
  },
  _removeProduct: function(id) {
    var p = null;
    this.state.produtos.forEach(function(x) { if (x.id === id) p = x; });
    if (!p) return { ok: false, message: 'Produto não encontrado.' };
    p.status = '❌ Descartado'; p.classificacao = '⚫ DESCARTADO'; p.atualizadoEm = this._ts();
    this._log('ARCHIVE', 'Produto', id, 'Produto arquivado (descartado).');
    return { ok: true, message: 'Produto arquivado. O registro permanece para auditoria.' };
  },
  _deleteProduct: function(id) {
    var i = -1, p = null;
    this.state.produtos.forEach(function(x, k) { if (x.id === id) { p = x; i = k; } });
    if (!p) return { ok: false, message: 'Produto não encontrado.' };
    var antes = this.state.conteudos.length;
    this.state.conteudos = this.state.conteudos.filter(function(c) { return c.produtoId !== id; });
    var nCont = antes - this.state.conteudos.length;
    this.state.produtos.splice(i, 1);
    this._log('DELETE', 'Produto', id, 'Produto excluído definitivamente: ' + p.produto +
      (nCont ? ' (' + nCont + ' conteúdo(s) vinculado(s) removido(s))' : ''));
    return { ok: true, message: 'Produto excluído definitivamente.' };
  },

  /* ---------- save_content ---------- */
  _saveContent: function(p) {
    var err = {};
    var pid = String(p.produtoId || '');
    var titulo = String(p.titulo || '').trim();
    var data = String(p.data || '');
    var tipo = String(p.tipo || '');
    var gancho = String(p.gancho || '');
    var st = String(p.status || '').trim() || '📊 Em análise';
    var views = this._num(p.views), curtidas = this._num(p.curtidas), comentarios = this._num(p.comentarios);
    var compartilh = this._num(p.compartilh), clicks = this._num(p.clicks), carrinhos = this._num(p.carrinhos);
    var pedidos = this._num(p.pedidos), vendas = this._num(p.vendas);

    if (pid === '') err.produtoId = 'Escolha o produto.';
    else if (!this.state.produtos.some(function(x) { return x.id === pid; }))
      err.produtoId = 'Produto não encontrado (cadastre-o primeiro).';
    if (titulo === '') err.titulo = 'Título é obrigatório.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(Date.parse(data))) err.data = 'Data de publicação inválida.';
    if (tipo === '' || !this._emLista('tipos_conteudo', tipo)) err.tipo = 'Tipo de conteúdo inválido.';
    if (gancho === '' || !this._emLista('ganchos', gancho)) err.gancho = 'Gancho inválido.';
    if (!this._emLista('status_conteudo', st)) err.status = 'Status inválido.';
    if ([views, curtidas, comentarios, compartilh, clicks, carrinhos, pedidos, vendas].some(function(v) { return v < 0; }))
      err.views = 'Métricas não podem ser negativas.';
    if (Object.keys(err).length) return { ok: false, campos: err, message: 'Verifique os campos destacados.' };

    var prod = null;
    this.state.produtos.forEach(function(x) { if (x.id === pid) prod = x; });
    var comissao;
    var comRaw = p.comissao === undefined || p.comissao === null || String(p.comissao).trim() === '' ? null : this._numOrNull(p.comissao);
    if (comRaw === null) {
      comissao = this._round2(vendas * (prod.comissaoVenda || 0));
    } else {
      if (comRaw < 0) return { ok: false, campos: { comissao: 'Comissão não pode ser negativa.' }, message: 'Verifique os campos destacados.' };
      comissao = this._round2(comRaw);
    }

    var id = String(p.id || '').trim();
    if (id) {
      var alvo = null;
      this.state.conteudos.forEach(function(x) { if (x.id === id) alvo = x; });
      if (!alvo) return { ok: false, message: 'Conteúdo não encontrado.' };
      var antes = alvo.produtoId;
      alvo.produtoId = pid; alvo.data = data; alvo.tipo = tipo; alvo.gancho = gancho;
      alvo.titulo = titulo; alvo.url = String(p.url || ''); alvo.status = st;
      alvo.views = views; alvo.curtidas = curtidas; alvo.comentarios = comentarios;
      alvo.compartilh = compartilh; alvo.clicks = clicks; alvo.carrinhos = carrinhos;
      alvo.pedidos = pedidos; alvo.vendas = vendas; alvo.comissao = comissao; alvo.obs = String(p.obs || '');
      if (antes !== pid) this._recalcProduto(antes);
      this._recalcProduto(pid);
      this._log('UPDATE', 'Conteúdo', id, 'Conteúdo atualizado: ' + titulo);
      return { ok: true, id: id, message: 'Conteúdo atualizado com sucesso.' };
    }
    id = this._proximoId('CNT');
    this.state.conteudos.push({
      id: id, produtoId: pid, data: data, tipo: tipo, gancho: gancho, titulo: titulo,
      url: String(p.url || ''), status: st, views: views, curtidas: curtidas, comentarios: comentarios,
      compartilh: compartilh, clicks: clicks, carrinhos: carrinhos, pedidos: pedidos,
      vendas: vendas, comissao: comissao, obs: String(p.obs || '')
    });
    this._recalcProduto(pid);
    this._log('CREATE', 'Conteúdo', id, 'Conteúdo cadastrado: ' + titulo);
    return { ok: true, id: id, message: 'Conteúdo cadastrado com sucesso.' };
  },
  _removeContent: function(id) {
    var c = null;
    this.state.conteudos.forEach(function(x) { if (x.id === id) c = x; });
    if (!c) return { ok: false, message: 'Conteúdo não encontrado.' };
    c.status = '❌ Arquivado';
    this._recalcProduto(c.produtoId);
    this._log('ARCHIVE', 'Conteúdo', id, 'Conteúdo arquivado.');
    return { ok: true, message: 'Conteúdo arquivado. O registro permanece para auditoria.' };
  },

  /* ---------- save_corte / remove_corte (aba Cortes) ---------- */
  _saveCorte: function(p) {
    p = p || {};
    var titulo = String(p.titulo || '').trim();
    var link = String(p.link || '').trim();
    var descricao = String(p.descricao || '').trim();
    var publicado = !!p.publicado;
    var dataPub = p.dataPublicacao ? String(p.dataPublicacao).slice(0, 10) : '';

    var campos = {};
    if (!titulo) campos.titulo = 'Título é obrigatório.';
    if (!link) campos.link = 'Cole o link do vídeo.';
    else if (!/^https?:\/\//i.test(link)) campos.link = 'O link deve começar com https://';
    if (publicado && !/^\d{4}-\d{2}-\d{2}$/.test(dataPub)) campos.dataPublicacao = 'Informe a data de publicação.';
    if (Object.keys(campos).length) {
      return { ok: false, campos: campos, message: 'Verifique os campos destacados.' };
    }
    if (!publicado) dataPub = '';

    if (p.id) {
      var c = null;
      this.state.cortes.forEach(function(x) { if (x.id === p.id) c = x; });
      if (!c) return { ok: false, message: 'Corte não encontrado.' };
      c.link = link; c.titulo = titulo; c.descricao = descricao;
      c.publicado = publicado; c.dataPublicacao = dataPub || null;
      this._log('UPDATE', 'Corte', c.id, 'Corte atualizado: ' + titulo +
        (publicado ? ' (publicado em ' + this._fmtDataBR(dataPub) + ')' : ''));
      return { ok: true, id: c.id, message: 'Corte atualizado com sucesso.' };
    }
    var id = this._proximoId('CRT');
    this.state.cortes.push({
      id: id, link: link, titulo: titulo, descricao: descricao,
      publicado: publicado, dataPublicacao: dataPub || null, criadoEm: this._ts()
    });
    this._log('CREATE', 'Corte', id, 'Corte registrado: ' + titulo);
    return { ok: true, id: id, message: 'Corte registrado com sucesso.' };
  },
  _removeCorte: function(id) {
    var i = -1;
    this.state.cortes.forEach(function(x, k) { if (x.id === id) i = k; });
    if (i === -1) return { ok: false, message: 'Corte não encontrado.' };
    var nome = this.state.cortes[i].titulo;
    this.state.cortes.splice(i, 1);
    this._log('DELETE', 'Corte', id, 'Corte excluído: ' + nome);
    return { ok: true, message: 'Corte excluído.' };
  },
  _fmtDataBR: function(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
  },

  /* ---------- save_listas (menus suspensos editáveis na Configuração) ---------- */
  _saveListas: function(p) {
    p = p || {};
    var chaves = ['categorias', 'prioridades', 'ganchos', 'status_produto', 'classificacoes', 'tipos_conteudo', 'status_conteudo'];
    for (var i = 0; i < chaves.length; i++) {
      var k = chaves[i];
      if (!Array.isArray(p[k])) return { ok: false, message: 'Lista ausente ou inválida: ' + k + '.' };
      var vistos = {};
      var arr = [];
      for (var j = 0; j < p[k].length; j++) {
        var v = String(p[k][j]).trim();
        if (!v) continue;
        if (v.length > 60) return { ok: false, message: 'Item muito longo na lista ' + k + ' (máx. 60 caracteres).' };
        var nk = v.toLowerCase();
        if (vistos[nk]) return { ok: false, message: 'Item duplicado na lista ' + k + ': "' + v + '".' };
        vistos[nk] = true;
        arr.push(v);
      }
      if (!arr.length) return { ok: false, message: 'A lista ' + k + ' precisa de pelo menos 1 item.' };
      this.state.listas[k] = arr;
    }
    this._log('CONFIG', 'Sistema', '—', 'Listas da ferramenta atualizadas pela Configuração.');
    return { ok: true, message: 'Listas salvas com sucesso.' };
  },

  /* ---------- save_config ---------- */
  _saveConfig: function(p) {
    var c = this.state.config;
    var metaComissao = this._numOrNull(p.metaComissao);
    var metaVendas = this._numOrNull(p.metaVendas);
    var metaConteudos = this._numOrNull(p.metaConteudos);
    if (metaComissao === null || metaComissao < 0) return { ok: false, message: 'Meta de comissão inválida.' };
    if (metaVendas === null || metaVendas < 0) return { ok: false, message: 'Meta de vendas inválida.' };
    if (metaConteudos === null || metaConteudos < 0) return { ok: false, message: 'Meta de conteúdos inválida.' };
    var r1 = this._numOrNull(p.regraVideosSemVenda);
    var r2 = this._numOrNull(p.regraVendasPromissor);
    var r3 = this._numOrNull(p.regraVendasCampeao);
    var r4 = this._numOrNull(p.regraCrescimentoPct);
    if (r1 === null || r1 < 1) return { ok: false, message: 'Regra de vídeos sem venda deve ser 1 ou mais.' };
    if (r2 === null || r2 < 1) return { ok: false, message: 'Regra de promissor deve ser 1 ou mais.' };
    if (r3 === null || r3 < 1) return { ok: false, message: 'Regra de campeão deve ser 1 ou mais.' };
    if (r4 === null || r4 < 0 || r4 > 1000) return { ok: false, message: 'Regra de crescimento deve estar entre 0 e 1000.' };

    c.nomeOperacao = String(p.nomeOperacao || '');
    c.nomeUsuario = String(p.nomeUsuario || '');
    c.urlWebApp = String(p.urlWebApp || '');
    c.metaComissao = metaComissao; c.metaVendas = metaVendas; c.metaConteudos = metaConteudos;
    c.regras = { videosSemVenda: r1, vendasPromissor: r2, vendasCampeao: r3, crescimentoPct: r4 };
    this._log('CONFIG', 'Sistema', '—', 'Configurações atualizadas pelo painel.');
    return { ok: true, message: 'Configurações salvas com sucesso.', config: c };
  },

  /* ---------- diagnóstico ---------- */
  _diagnostico: function() {
    var linhas = [], falhas = 0;
    var add = function(ok, texto) {
      linhas.push({ ok: ok, texto: texto });
      if (!ok) falhas++;
    };
    add(true, 'CONFIG presente com os dados do sistema.');
    add((this.state.listas.categorias || []).length >= 5, 'LISTAS: categorias carregadas (' + this.state.listas.categorias.length + ' itens).');
    add((this.state.listas.status_produto || []).length >= 5, 'LISTAS: status de produto carregados (' + this.state.listas.status_produto.length + ' itens).');
    add(true, 'PRODUTOS: ' + this.state.produtos.length + ' registro(s) na base.');
    add(true, 'CONTEUDOS: ' + this.state.conteudos.length + ' registro(s) na base.');
    var orfaos = this.state.conteudos.filter(function(c) {
      return !this.state.produtos.some(function(p) { return p.id === c.produtoId; });
    }, this).length;
    add(orfaos === 0, orfaos === 0 ? 'Integridade: todo conteúdo aponta para um produto válido.'
      : 'Integridade: ' + orfaos + ' conteúdo(s) órfão(s) encontrados.');
    var neg = this.state.produtos.filter(function(p) { return p.videos < 0 || p.vendas < 0 || p.comissaoTotal < 0; }).length;
    add(neg === 0, 'Agregados de produtos consistentes (vídeos/vendas/comissão).');
    add(true, 'LOGS: ' + this.state.logs.length + ' evento(s) registrados.');
    this._log('DIAG', 'Sistema', '—', 'Diagnóstico executado (' + falhas + ' falha(s)).');
    return { ok: falhas === 0, status: falhas === 0 ? 'SISTEMA OK' : falhas + ' PROBLEMA(S) ENCONTRADO(S)', linhas: linhas };
  },

  /* ---------- demo (mesmos 10 produtos / 15 conteúdos da versão original) ---------- */
  _demo: function() {
    if (this.state.produtos.length > 0) {
      return { ok: false, message: 'Já existem produtos na base (' + this.state.produtos.length + '). A demonstração não roda para evitar duplicar dados.' };
    }
    var P = [
      ["Mini Projetor Portátil", "Tecnologia & Gadgets", 149.9, 15, "TikTok Shop", "🔥 Alta", "Demonstração", "📈 Escalando", "🟢 CAMPEÃO", "Criativos noturnos performam muito bem."],
      ["Luminária LED Sunset", "Casa & Organização", 89.9, 18, "TikTok Shop", "🔥 Alta", "Antes & Depois", "🧪 Em teste", "🔵 PROMISSOR", ""],
      ["Organizador de Cabos Magnético", "Escritório & Setup", 39.9, 22, "TikTok Shop", "🟡 Média", "Problema → Solução", "🧪 Em teste", "🟡 EM TESTE", ""],
      ["Garrafa Térmica 1L Inox", "Cozinha", 119.9, 14, "TikTok Shop", "🟡 Média", "Review / Opinião", "📤 Conteúdo publicado", "🟡 EM TESTE", ""],
      ["Suporte de Celular Automotivo", "Automotivo", 49.9, 25, "Shopee Cross", "🟡 Média", "Teste Real", "📋 Aprovado para teste", "🟡 EM TESTE", "Aguardando primeiro roteiro."],
      ["Kit Escovas Elétricas", "Beleza & Cuidados", 79.9, 20, "TikTok Shop", "⚪ Baixa", "Curiosidade", "🎬 Em produção", "🟡 EM TESTE", ""],
      ["Tapete Antiderrapante PVC", "Casa & Organização", 129.9, 16, "TikTok Shop", "⚪ Baixa", "Antes & Depois", "🧪 Em teste", "🔴 FRACO", "Testar novo ângulo de filmagem."],
      ["Roteador Mesh Compacto", "Tecnologia & Gadgets", 249.9, 12, "Amazon BR", "🔥 Alta", "Comparação", "🆕 Novo", "🟡 EM TESTE", "Pesquisa de ganchos em andamento."],
      ["Brinco Luminoso Neon", "Moda & Acessórios", 29.9, 30, "TikTok Shop", "🔥 Alta", "Surpresa", "📈 Escalando", "🔵 PROMISSOR", ""],
      ["Manta Aquecedora USB", "Casa & Organização", 99.9, 17, "TikTok Shop", "⚪ Baixa", "Economia / Oferta", "⏸️ Pausado", "🟠 REPOSICIONAR", "Testar público diferente."]
    ];
    var C = [
      ["Mini Projetor Portátil", 50, "Demonstração", "Demonstração", "Esse mini projetor transformou meu quarto em cinema", "📤 Publicado", 48200, 9],
      ["Mini Projetor Portátil", 32, "Antes & Depois", "Antes & Depois", "Do quarto escuro ao cinema particular", "🏆 Vencedor", 61300, 14],
      ["Mini Projetor Portátil", 12, "Curiosidade", "Curiosidade", "R$150 no TikTok Shop? Olha o tamanho dessa tela", "📤 Publicado", 74800, 17],
      ["Mini Projetor Portátil", 3, "Teste", "Teste Real", "Testei por 7 dias e o resultado me surpreendeu", "📊 Em análise", 39400, 8],
      ["Luminária LED Sunset", 21, "Antes & Depois", "Antes & Depois", "Seu quarto vai ter cara de filmagem", "📊 Em análise", 27600, 5],
      ["Luminária LED Sunset", 6, "Curiosidade", "Curiosidade", "A luz que todo criativo tem escondida", "📤 Publicado", 33100, 6],
      ["Organizador de Cabos Magnético", 15, "Problema → Solução", "Problema → Solução", "Cansado desse emaranhado de cabos?", "📊 Em análise", 18400, 2],
      ["Organizador de Cabos Magnético", 4, "Demonstração", "Demonstração", "Organize sua mesa em 30 segundos", "📤 Publicado", 22100, 1],
      ["Garrafa Térmica 1L Inox", 26, "Review", "Review / Opinião", "Uso há 1 mês: vale a pena mesmo?", "📊 Em análise", 15900, 3],
      ["Tapete Antiderrapante PVC", 40, "Antes & Depois", "Antes & Depois", "Seu piso agradece", "📤 Publicado", 9800, 0],
      ["Tapete Antiderrapante PVC", 24, "Demonstração", "Demonstração", "Olha essa facilidade de instalar", "📤 Publicado", 7300, 0],
      ["Tapete Antiderrapante PVC", 9, "Teste", "Teste Real", "Testei em dia de chuva", "📤 Publicado", 5100, 0],
      ["Brinco Luminoso Neon", 18, "Curiosidade", "Surpresa", "Esse brinco acende no escuro", "📊 Em análise", 52700, 11],
      ["Brinco Luminoso Neon", 5, "Demonstração", "Demonstração", "Glow up em 10 segundos", "📤 Publicado", 44300, 9],
      ["Brinco Luminoso Neon", 1, "Review", "Opinião forte", "Nunca vi nada igual nesse preço", "📤 Publicado", 29800, 6]
    ];
    var hoje = Date.now();
    var dias = function(n) {
      var d = new Date(hoje - n * 86400000);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    var pPorNome = {};
    P.forEach(function(r, i) {
      var id = 'PRD-' + String(i + 1).padStart(4, '0');
      this.state.produtos.push({
        id: id, produto: r[0], categoria: r[1], preco: r[2], comissaoPct: r[3],
        comissaoVenda: this._round2(r[2] * r[3] / 100),
        link: 'https://example.com/demo/prd' + String(i + 1).padStart(4, '0'),
        loja: r[4], prioridade: r[5], gancho: r[6], status: r[7], classificacao: r[8],
        videos: 0, vendas: 0, comissaoTotal: 0,
        dataCadastro: dias(60), atualizadoEm: this._ts(), obs: r[9]
      });
      pPorNome[r[0]] = id;
    }, this);
    C.forEach(function(r, i) {
      var nome = r[0], d = r[1], tipo = r[2], gancho = r[3], titulo = r[4], st = r[5], views = r[6], vendas = r[7];
      var cv = this.state.produtos.filter(function(p) { return p.id === pPorNome[nome]; })[0].comissaoVenda;
      var curtidas = Math.round(views * 0.045);
      var comentarios = Math.round(views * 0.006);
      var compartilh = Math.round(curtidas * 0.12);
      var clicks = Math.round(views * 0.035);
      var carrinhos = Math.round(clicks * 0.22);
      var id = 'CNT-' + String(i + 1).padStart(4, '0');
      this.state.conteudos.push({
        id: id, produtoId: pPorNome[nome], data: dias(d), tipo: tipo, gancho: gancho, titulo: titulo,
        url: 'https://example.com/demo/video-' + (i + 1), status: st,
        views: views, curtidas: curtidas, comentarios: comentarios, compartilh: compartilh,
        clicks: clicks, carrinhos: carrinhos, pedidos: Math.max(vendas, 1),
        vendas: vendas, comissao: this._round2(vendas * cv), obs: ''
      });
    }, this);
    this.state.produtos.forEach(function(p) { LOCALDB._recalcProduto(p.id); });
    this._log('DEMO', 'Sistema', '—', 'Dados de demonstração criados (10 produtos, 15 conteúdos).');
    return { ok: true, message: 'Dados de demonstração criados: 10 produtos e 15 conteúdos.' };
  }
};

// inicializa na carga
LOCALDB._load();
