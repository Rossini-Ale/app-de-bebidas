const API = '';
let produtos = [], carrinho = [], editingId = null, cartSheetOpen = false, qtyPickerId = null;
let metodoPagamento = 'dinheiro', ultimaVendaId = null, undoTimer = null;
let sortVenda = 'vendido', sortEstoque = 'az', sortRelatorio = 'vendido', sortHistorico = 'recente';
let histPagina = 1;
const HIST_POR_PAG = 20;
let vendidoMap = {}, relatorioItens = null, historicoVendas = null;
let dinheiroVendas = 0, wakeLock = null, reposicaoId = null, reposicaoModo = 'add';
let eventoAtual = null, operadorAtual = 'Caixa', venderAoCusto = false;
let categoriaFiltro = '';
let categoriaFiltroEstoque = '';
let wsConn = null, wsConectado = false;
let qmCurrentVal = '';
let reposicaoHistoricoAberto = false;
let filtroPagamento = '';
let filtroOperador  = '';

function fmt(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
function fmtShort(v) {
  const n = Number(v);
  if (n >= 10000) return 'R$' + (n / 1000).toFixed(1).replace('.', ',') + 'k';
  if (Number.isInteger(n)) return 'R$' + n;
  return 'R$' + n.toFixed(2).replace('.', ',');
}

function fmtMoeda(v) { return Number(v).toFixed(2).replace('.', ','); }
function lerMoeda(id) {
  const raw = document.getElementById(id)?.value || '0';
  return parseFloat(raw.replace(',', '.')) || 0;
}
function mascaraMoedaInline(el) {
  const digits = el.value.replace(/\D/g, '').slice(-8);
  if (!digits) { el.value = ''; return; }
  const padded = digits.padStart(3, '0');
  const intPart = padded.slice(0, -2).replace(/^0+/, '') || '0';
  el.value = intPart + ',' + padded.slice(-2);
}

function countUp(el, toVal, formatFn, duration = 550) {
  if (!el) return;
  const fromVal = parseFloat(el.dataset.countVal) || 0;
  el.dataset.countVal = toVal;
  if (el._countRaf) cancelAnimationFrame(el._countRaf);
  if (fromVal === toVal) { el.textContent = formatFn(toVal); return; }
  const start = performance.now();
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = formatFn(fromVal + (toVal - fromVal) * eased);
    if (t < 1) el._countRaf = requestAnimationFrame(step);
    else el.textContent = formatFn(toVal);
  }
  el._countRaf = requestAnimationFrame(step);
}


function parseDataUTC(str) {
  const s = String(str);
  if (s.includes('Z') || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(s.replace(' ', 'T') + 'Z');
}
function fmtDataHora(str) {
  const d = parseDataUTC(str);
  const data = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${data} às ${hora}`;
}

/* ── Skeleton Loading ─────────────────────── */
function renderSkeleton(containerId, count = 6, tipo = 'card') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (tipo === 'card') {
    el.innerHTML = '<div class="produto-grid">' + Array.from({length: count}, () =>
      `<div class="skeleton-card">
        <div class="skel skel-name"></div>
        <div class="skel skel-preco"></div>
        <div class="skel skel-stock"></div>
        <div class="skel skel-bar"></div>
      </div>`).join('') + '</div>';
  } else {
    el.innerHTML = Array.from({length: count}, () =>
      `<div class="skel-list-item">
        <div class="skel-line w-70"></div>
        <div class="skel-line w-40"></div>
      </div>`).join('');
  }
}

/* ── Feedback ─────────────────────────────── */
function vibrar(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function flashCard(id) {
  const card = document.querySelector(`.produto-card[data-id="${id}"]`);
  if (!card) return;
  card.classList.remove('flash');
  void card.offsetWidth; // força reflow para reiniciar animação
  card.classList.add('flash');
  card.addEventListener('animationend', () => card.classList.remove('flash'), { once: true });
}

/* ── Toast ────────────────────────────────── */
function showToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 2800);
}

/* ── Mostrar/ocultar senha ────────────────── */
function toggleMostrarSenha() {
  const inp = document.getElementById('login-senha');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}
function toggleMostrarSenhaAdmin(id) {
  const inp = document.getElementById(id);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

/* ── Tema escuro ──────────────────────────── */
function aplicarTema() {
  const tema = localStorage.getItem('tema') || 'light';
  document.documentElement.setAttribute('data-theme', tema);
  const btn = document.getElementById('btn-dark');
  if (btn) btn.textContent = tema === 'dark' ? '☀' : '🌙';
}
function toggleDarkMode() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('tema', next);
  const btn = document.getElementById('btn-dark');
  if (btn) btn.textContent = next === 'dark' ? '☀' : '🌙';
}

/* ── Combo toggle ─────────────────────────── */
function toggleComboRow(prefix) {
  // 'new' and 'ed' use prefix-combo-check; numeric IDs use combo-check-{id}
  const checkId = (prefix === 'new' || prefix === 'ed') ? `${prefix}-combo-check` : `combo-check-${prefix}`;
  const check = document.getElementById(checkId);
  const row = document.getElementById(`combo-row-${prefix}`);
  if (row) row.style.display = check?.checked ? 'grid' : 'none';
}

/* Atualiza placeholder do campo Estoque conforme dose/fardo */
function atualizarPlaceholderQty() {
  const doseCheck = document.getElementById('new-dose-check');
  const fardoQtd  = parseInt(document.getElementById('new-fardo-qtd')?.value) || 0;
  const qtyEl     = document.getElementById('new-qty');
  if (!qtyEl) return;
  if (doseCheck?.checked) return; // dose já gerencia o placeholder
  qtyEl.placeholder = fardoQtd >= 2 ? `Fardos (1 = ${fardoQtd} un.)` : 'Estoque';
}

function atualizarBadgeEstoque() {
  const baixos = produtos.filter(p => Number(p.estoque_minimo) > 0 && p.estoque <= Number(p.estoque_minimo));
  const n = baixos.length;

  // Badge no bottom nav (mobile)
  const navBadge = document.getElementById('stock-nav-badge');
  if (navBadge) { navBadge.textContent = n; navBadge.classList.toggle('show', n > 0); }

  // Badge no tab desktop
  const tabBadge = document.getElementById('stock-tab-badge');
  if (tabBadge) { tabBadge.textContent = n; tabBadge.classList.toggle('show', n > 0); }

  // Banner dentro da aba Estoque
  const banner = document.getElementById('stock-alert-banner');
  const msg    = document.getElementById('stock-alert-msg');
  if (banner && msg) {
    if (n > 0) {
      const nomes = baixos.map(p => `${p.nome} (${p.estoque}${Number(p.estoque_minimo) > 0 ? '/' + p.estoque_minimo : ''})`).join(', ');
      msg.innerHTML = `<strong>${n} produto${n > 1 ? 's' : ''} abaixo do estoque mínimo:</strong> ${nomes}`;
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  }
}

function toggleDoseRow(prefix) {
  const checkId = (prefix === 'new' || prefix === 'ed') ? `${prefix}-dose-check` : `dose-check-${prefix}`;
  const check = document.getElementById(checkId);
  const row = document.getElementById(`dose-row-${prefix}`);
  if (row) row.style.display = check?.checked ? 'block' : 'none';
  // Atualiza placeholder do campo de estoque no formulário de novo produto
  if (prefix === 'new') {
    const qtyEl = document.getElementById('new-qty');
    if (qtyEl) {
      if (check?.checked) {
        qtyEl.placeholder = 'Qtd de garrafas';
      } else {
        atualizarPlaceholderQty(); // usa fardo se houver
      }
    }
  }
}

function calcularDose(prefix) {
  let garMlEl, dMlEl, gPrecoEl;
  if (prefix === 'new') {
    garMlEl  = document.getElementById('new-garrafa-ml');
    dMlEl    = document.getElementById('new-dose-ml');
    gPrecoEl = document.getElementById('new-garrafa-preco');
  } else if (prefix === 'ed') {
    garMlEl  = document.getElementById('ed-garrafa-ml');
    dMlEl    = document.getElementById('ed-dose-ml');
    gPrecoEl = document.getElementById('ed-garrafa-preco');
  } else {
    garMlEl  = document.getElementById(`edit-garrafa-ml-${prefix}`);
    dMlEl    = document.getElementById(`edit-dose-ml-${prefix}`);
    gPrecoEl = document.getElementById(`edit-garrafa-preco-${prefix}`);
  }
  const hint     = document.getElementById(`dose-hint-${prefix}`);
  if (!hint) return;
  const garMl  = parseInt(garMlEl?.value)  || 0;
  const dMl    = parseInt(dMlEl?.value)    || 0;
  const gPreco = parseFloat(gPrecoEl?.value) || 0;
  if (!garMl || !dMl) { hint.textContent = 'Preencha os ml da garrafa e da dose'; return; }
  const doses = Math.floor(garMl / dMl);
  const custo = gPreco > 0 ? gPreco / doses : null;
  hint.textContent = `${doses} doses/garrafa${custo ? ` · Custo/dose: ${fmt(custo)}` : ''}`;
}

/* ── Wake Lock ────────────────────────────── */
async function ativarWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {}
}
async function liberarWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); } catch {}
  wakeLock = null;
}

/* ── Navegação ────────────────────────────── */
function updateTabPill(tab, immediate) {
  const pill = document.getElementById('tab-pill');
  const activeBtn = document.querySelector(`.tab[data-tab="${tab}"]`);
  const container = document.querySelector('.tabs');
  if (!pill || !activeBtn || !container) return;
  const cRect = container.getBoundingClientRect();
  if (!cRect.width) return;
  const aRect = activeBtn.getBoundingClientRect();
  if (immediate) pill.style.transition = 'none';
  pill.style.left  = (aRect.left - cRect.left) + 'px';
  pill.style.width = aRect.width + 'px';
  if (immediate) requestAnimationFrame(() => requestAnimationFrame(() => { pill.style.transition = ''; }));
}

function updateBnavPill(tab, immediate) {
  const pill = document.getElementById('bnav-pill');
  const activeBtn = document.querySelector(`.bnav-tab[data-tab="${tab}"]`);
  const container = document.getElementById('bottom-nav');
  if (!pill || !activeBtn || !container) return;
  const cRect = container.getBoundingClientRect();
  if (!cRect.width) return;
  const aRect = activeBtn.getBoundingClientRect();
  if (immediate) pill.style.transition = 'none';
  pill.style.top    = (aRect.top - cRect.top) + 'px';
  pill.style.height = aRect.height + 'px';
  pill.style.left   = (aRect.left - cRect.left) + 'px';
  pill.style.width  = aRect.width + 'px';
  if (immediate) requestAnimationFrame(() => requestAnimationFrame(() => { pill.style.transition = ''; }));
}

function showTab(tab) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab, .bnav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(t => t.classList.add('active'));
  updateTabPill(tab);
  updateBnavPill(tab);
  if (tab === 'venda') ativarWakeLock(); else liberarWakeLock();
  if (tab === 'estoque')   { renderEstoque(); carregarReposicoes(); }
  if (tab === 'historico') carregarHistorico();
  if (tab === 'relatorio') carregarRelatorio();
  if (tab === 'venda')     { carregarProdutos(); carregarResumo(); }
  atualizarCartBar();
}

/* ── Ordenação ────────────────────────────── */
function setSortVenda(s) {
  sortVenda = s;
  document.querySelectorAll('#sort-venda .sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
  renderVenda();
}
function setSortEstoque(s) {
  sortEstoque = s;
  document.querySelectorAll('#sort-estoque .sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
  renderEstoque();
}
function setSortRelatorio(s) {
  sortRelatorio = s;
  document.querySelectorAll('#sort-relatorio .sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
  renderRelatorioLista();
}
function setSortHistorico(s) {
  sortHistorico = s;
  histPagina = 1;
  document.querySelectorAll('#sort-historico .sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === s));
  renderHistoricoLista();
}

function setBuscaHistorico() {
  histPagina = 1;
  renderHistoricoLista();
}

function setFiltroPagamento(pag) {
  filtroPagamento = pag;
  histPagina = 1;
  document.querySelectorAll('#hist-pag-filter .sort-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.pag === pag)
  );
  renderHistoricoLista();
}

function setFiltroOperador(op) {
  filtroOperador = op;
  histPagina = 1;
  renderHistoricoLista();
}

function atualizarSelectOperador() {
  const wrap  = document.getElementById('hist-op-filter');
  const sel   = document.getElementById('hist-op-select');
  if (!sel || !historicoVendas) return;
  const ops = [...new Set(historicoVendas.map(v => v.operador).filter(Boolean))].sort();
  if (ops.length <= 1) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';
  const current = sel.value;
  sel.innerHTML = `<option value="">Todos os operadores</option>` +
    ops.map(op => `<option value="${op}" ${op === current ? 'selected' : ''}>${op}</option>`).join('');
}

/* ── API ──────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const r = await fetch(API + '/api' + path, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
  const d = await r.json();
  if (r.status === 401) { mostrarLogin(); throw new Error('Sessão expirada'); }
  if (!r.ok) throw new Error(d.error || 'Erro');
  return d;
}

/* ── Auth ─────────────────────────────────── */
async function checkAuth() {
  try {
    const ev = await fetch(API + '/api/auth/me', { credentials: 'same-origin' });
    if (!ev.ok) { mostrarLogin(); return false; }
    const data = await ev.json();
    operadorAtual = data.operador || 'Caixa';
    setOperadorBadge(operadorAtual);
    atualizarNomeEvento(data.eventoNome || 'Caixa UNIFSP');
    return true;
  } catch { mostrarLogin(); return false; }
}

function atualizarNomeEvento(nome) {
  eventoAtual = { nome };
  document.title = nome + ' · Caixa';
  const h1 = document.querySelector('.header h1');
  if (h1) h1.textContent = nome;
  // Preenche campo do admin modal se já estiver aberto
  const inp = document.getElementById('admin-nome-inp');
  if (inp && !inp.value) inp.value = nome;
}

function mostrarLogin() {
  document.getElementById('login-screen').classList.add('visible');
  document.getElementById('btn-logout').style.display = 'none';
  document.getElementById('evento-badge').textContent = '';
  setTimeout(() => document.getElementById('login-operador').focus(), 100);
}

function ocultarLogin() {
  document.getElementById('login-screen').classList.remove('visible');
  document.getElementById('btn-logout').style.display = '';
}

function setOperadorBadge(nome) {
  const badge = document.getElementById('evento-badge');
  if (badge) badge.textContent = nome;
}

async function fazerLogin() {
  const btn      = document.getElementById('login-btn');
  const operador = document.getElementById('login-operador').value.trim();
  const senha    = document.getElementById('login-senha').value;
  const erro     = document.getElementById('login-erro');
  if (!operador) { erro.textContent = 'Informe seu nome'; return; }
  if (!senha)    { erro.textContent = 'Informe a senha'; return; }
  erro.textContent = '';
  btn.textContent = 'Entrando…'; btn.disabled = true;
  try {
    const data = await fetch(API + '/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operador, senha })
    });
    const json = await data.json();
    if (!data.ok) { erro.textContent = json.error || 'Erro ao entrar'; return; }
    operadorAtual = json.operador || operador;
    setOperadorBadge(operadorAtual);
    atualizarNomeEvento(json.eventoNome || 'Caixa UNIFSP');
    ocultarLogin();
    relatorioItens = null; historicoVendas = null;
    carregarTudo();
  } catch (e) { erro.textContent = 'Erro de conexão'; }
  finally { btn.textContent = 'Entrar'; btn.disabled = false; }
}

async function fazerLogout() {
  const btn = document.getElementById('btn-logout');
  if (!btn) return;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.title = 'Toque de novo para sair';
    btn._timer = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.title = 'Sair';
    }, 3000);
    return;
  }
  clearTimeout(btn._timer);
  btn.classList.remove('confirming');
  btn.title = 'Sair';
  await fetch(API + '/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  operadorAtual = 'Caixa';
  produtos = []; carrinho = [];
  relatorioItens = null; historicoVendas = null;
  document.getElementById('login-operador').value = '';
  document.getElementById('login-senha').value    = '';
  mostrarLogin();
}

async function carregarTudo() {
  try {
    await Promise.all([carregarProdutos(), carregarResumo()]);
    apiFetch('/vendas/relatorio').then(itens => {
      itens.forEach(i => { vendidoMap[i.id] = Number(i.qtd_vendida); });
      if (sortVenda === 'vendido') renderVenda();
      if (sortEstoque === 'vendido') renderEstoque();
    }).catch(() => {});
    document.getElementById('status-conexao').textContent = '● Online';
    document.getElementById('status-conexao').className = 'status-ok';
  } catch (e) {
    document.getElementById('status-conexao').textContent = '● Offline';
    document.getElementById('status-conexao').className = 'status-err';
  }
}

/* ── Produtos ─────────────────────────────── */
async function carregarProdutos() {
  if (!produtos.length) {
    renderSkeleton('venda-lista', 6, 'card');
    renderSkeleton('stock-list', 4, 'list');
  }
  try {
    const anteriores = [...produtos];
    produtos = await apiFetch('/produtos');
    if (anteriores.length) {
      produtos.forEach(p => {
        const ant = anteriores.find(o => o.id === p.id);
        if (!ant) return;
        if (ant.estoque > 0 && p.estoque === 0)
          showToast(`⚠ ${p.nome} zerou!`, 'error-toast');
        else if (ant.estoque > 24 && p.estoque <= 24)
          showToast(`⚠ Estoque baixo: ${p.nome} (${p.estoque} un.)`, 'error-toast');
      });
    }
    renderVenda();
    renderEstoque();
  } catch (e) {
    document.getElementById('venda-lista').innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`;
  }
}

function renderCatFiltros() {
  const el = document.getElementById('cat-filter-venda');
  if (!el) return;
  const cats = [...new Set(produtos.map(p => p.categoria || '').filter(Boolean))].sort();
  if (!cats.length) { el.innerHTML = ''; return; }
  const emojis = { 'Cerveja':'🍺','Cervejas':'🍺','Destilado':'🥃','Destilados':'🥃',
    'Comida':'🍔','Comidas':'🍔','Bebida':'🥤','Bebidas':'🥤',
    'Refrigerante':'🥤','Refrigerantes':'🥤','Água':'💧','Aguas':'💧',
    'Vinho':'🍷','Vinhos':'🍷','Shots':'🥂','Outros':'📦' };
  el.innerHTML = [{ label: 'Todos', val: '' }, ...cats.map(c => ({ label: c, val: c }))]
    .map(item => {
      const emoji = item.val ? (emojis[item.val] || '') : '';
      const txt   = emoji ? `${emoji} ${item.label}` : item.label;
      return `<button class="cat-btn${categoriaFiltro === item.val ? ' active' : ''}" onclick="setCatFiltro('${item.val}')">${txt}</button>`;
    })
    .join('');
}

function setCatFiltro(cat) {
  categoriaFiltro = cat;
  renderVenda();
}

function renderCatFiltrosEstoque() {
  const el = document.getElementById('cat-filter-estoque');
  if (!el) return;
  const cats = [...new Set(produtos.map(p => p.categoria || '').filter(Boolean))].sort();
  if (cats.length <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = [{ label: 'Todos', val: '' }, ...cats.map(c => ({ label: c, val: c }))]
    .map(item => `<button class="cat-btn${categoriaFiltroEstoque === item.val ? ' active' : ''}" onclick="setCatFiltroEstoque('${item.val}')">${item.label}</button>`)
    .join('');
}

function setCatFiltroEstoque(cat) {
  categoriaFiltroEstoque = cat;
  renderEstoque();
}

function renderVenda() {
  renderCatFiltros();
  const l = document.getElementById('venda-lista');
  if (!produtos.length) {
    l.innerHTML = '<div class="empty-state">Nenhum produto cadastrado</div>';
    return;
  }
  const sorted = [...produtos].sort((a, b) => {
    if (a.estoque === 0 && b.estoque > 0) return 1;
    if (b.estoque === 0 && a.estoque > 0) return -1;
    if (sortVenda === 'az')      return a.nome.localeCompare(b.nome, 'pt-BR');
    if (sortVenda === 'estoque') return b.estoque - a.estoque;
    return (vendidoMap[b.id] || 0) - (vendidoMap[a.id] || 0);
  });
  const termo = (document.getElementById('busca-produto')?.value || '').trim().toLowerCase();
  let lista = termo ? sorted.filter(p => p.nome.toLowerCase().includes(termo)) : sorted;
  if (categoriaFiltro) lista = lista.filter(p => (p.categoria || '') === categoriaFiltro);
  const maxEstoque = Math.max(...lista.map(p => p.estoque), 1);

  if (lista.length === 0) {
    l.innerHTML = '<div class="empty-state"><span style="font-size:28px;display:block;margin-bottom:4px;opacity:.55">🔍</span>Nenhum produto encontrado<br><span style="font-size:12px">Tente outro termo ou categoria</span></div>';
    return;
  }

  // Rank dos top 3 mais vendidos (baseado em todos os produtos, não na lista filtrada)
  const rankMap = {};
  const prodsPorVendas = [...produtos]
    .filter(p => (vendidoMap[p.id] || 0) > 0)
    .sort((a, b) => (vendidoMap[b.id] || 0) - (vendidoMap[a.id] || 0));
  prodsPorVendas.slice(0, 3).forEach((p, i) => { rankMap[p.id] = i + 1; });

  l.innerHTML = '<div class="produto-grid">' + lista.map((p, index) => {
    const isDose     = !!(p.dose_ml && p.garrafa_ml);
    const unidade    = isDose ? 'doses' : 'un.';
    const noStock    = p.estoque === 0;
    const minimo     = Number(p.estoque_minimo) || 0;
    const veryLow    = p.estoque > 0 && minimo > 0 && p.estoque <= minimo;
    const lowStock   = p.estoque > 0 && minimo > 0 && p.estoque > minimo && p.estoque <= minimo * 2;
    const itemCart   = carrinho.find(c => c.id === p.id);
    const inCart     = !!itemCart;
    const comboActive = inCart && p.combo_qtd && p.combo_preco && itemCart.qty >= p.combo_qtd;
    const badge      = `<span class="pc-badge" style="${inCart ? '' : 'display:none'}" onclick="event.stopPropagation();abrirQtyPicker(${p.id})">${inCart ? itemCart.qty : ''}</span>`;

    // Rank badge (só para produtos com estoque)
    const rank = !noStock ? (rankMap[p.id] || 0) : 0;
    const rankBadge = rank === 1 ? `<span class="pc-rank pc-rank-1">🔥 #1</span>`
                    : rank === 2 ? `<span class="pc-rank pc-rank-2">#2</span>`
                    : rank === 3 ? `<span class="pc-rank pc-rank-3">#3</span>` : '';

    // Tag esgotado (visível mesmo com card sem opacity)
    const esgotadoBadge = noStock ? `<span class="pc-esgotado-tag">Esgotado</span>` : '';

    const stockLabel = noStock  ? 'Sem estoque' :
                       veryLow  ? `⚠ ${p.estoque} ${unidade}` :
                                  `${p.estoque} ${unidade}`;
    const classes    = ['produto-card', noStock ? 'no-stock' : '', inCart ? 'in-cart' : '',
                        veryLow ? 'very-low-stock' : lowStock ? 'low-stock' : '',
                        comboActive ? 'combo-active' : ''].filter(Boolean).join(' ');
    const onclick    = noStock ? '' : `onclick="addCarrinho(${p.id})"`;
    const barPct     = noStock ? 0 : Math.round((p.estoque / maxEstoque) * 100);
    const barColor   = veryLow ? 'var(--red)' : lowStock ? 'var(--amber)' : 'var(--green)';
    const comboBadge = (p.combo_qtd && p.combo_preco)
      ? `<div class="pc-combo">${p.combo_qtd} ${unidade} por ${fmt(Number(p.combo_preco) * p.combo_qtd)}</div>` : '';
    const doseBadge  = isDose
      ? `<div class="pc-dose">${p.dose_ml}ml/dose</div>` : '';
    return `<div class="${classes}" data-id="${p.id}" ${onclick} style="animation-delay:${Math.min(index * 28, 140)}ms">
      ${rankBadge}${esgotadoBadge}${badge}
      <div class="pc-nome">${p.nome}</div>
      <div class="pc-preco">${fmt(p.preco)}</div>
      ${doseBadge}${comboBadge}
      <div class="pc-stock">${stockLabel}</div>
      <div class="pc-stock-bar-wrap"><div class="pc-stock-bar" style="width:${barPct}%;background:${barColor}"></div></div>
    </div>`;
  }).join('') + '</div>';
}

function renderEstoque() {
  renderCatFiltrosEstoque();
  const l = document.getElementById('stock-list');
  document.getElementById('m-produtos').textContent = produtos.length;
  if (!produtos.length) {
    l.innerHTML = '<div class="empty-state">Nenhum produto ainda</div>';
    return;
  }
  const sortedEstoque = [...produtos].sort((a, b) => {
    if (sortEstoque === 'az')      return a.nome.localeCompare(b.nome, 'pt-BR');
    if (sortEstoque === 'estoque') return b.estoque - a.estoque;
    return (vendidoMap[b.id] || 0) - (vendidoMap[a.id] || 0);
  });

  // Filtro de busca
  const termoEstoque = (document.getElementById('busca-estoque')?.value || '').trim().toLowerCase();
  let listaEstoque = termoEstoque
    ? sortedEstoque.filter(p => p.nome.toLowerCase().includes(termoEstoque) || (p.categoria || '').toLowerCase().includes(termoEstoque))
    : sortedEstoque;
  // Filtro de categoria
  if (categoriaFiltroEstoque) listaEstoque = listaEstoque.filter(p => (p.categoria || '') === categoriaFiltroEstoque);

  atualizarBadgeEstoque();

  if (!listaEstoque.length) {
    l.innerHTML = '<div class="empty-state"><span style="font-size:28px;display:block;margin-bottom:4px;opacity:.55">🔍</span>Nenhum produto encontrado</div>';
    return;
  }

  l.innerHTML = listaEstoque.map(p => {
    const hasDose       = !!(p.dose_ml && p.garrafa_ml);
    const dosesPorGar   = hasDose ? Math.floor(Number(p.garrafa_ml) / Number(p.dose_ml)) : 1;
    const unidade       = hasDose ? 'doses' : 'un.';
    const margem        = p.custo > 0 ? Math.round(((p.preco - p.custo) / p.preco) * 100) : null;
    const isRepondo     = reposicaoId === p.id;
    const minimo        = Number(p.estoque_minimo) || 0;
    const atMin         = minimo > 0 && p.estoque <= minimo;
    const nearMin       = minimo > 0 && p.estoque > minimo && p.estoque <= minimo * 2;
    const dotClass      = p.estoque === 0 ? 'red' : atMin ? 'red' : nearMin ? 'amber' : 'green';
    const qtyColor      = p.estoque === 0 ? 'color:var(--red)' : atMin ? 'color:var(--red)' : nearMin ? 'color:var(--amber)' : '';
    const comboInfo     = (p.combo_qtd && p.combo_preco)
      ? `<div class="stock-combo">Combo: ${p.combo_qtd} ${unidade} por ${fmt(Number(p.combo_preco) * p.combo_qtd)}</div>` : '';
    const hasFardo      = Number(p.unidades_por_fardo) >= 2;
    const fardoQtd      = hasFardo ? Number(p.unidades_por_fardo) : 1;
    const doseInfo      = hasDose
      ? `<div class="stock-combo">🥃 ${p.dose_ml}ml/dose · ${dosesPorGar} doses/garrafa · ${p.estoque} doses em estoque</div>` : '';
    const fardoInfo     = hasFardo
      ? `<div class="stock-combo">📦 ${fardoQtd} un./fardo${p.estoque > 0 ? ` · ${(p.estoque / fardoQtd).toFixed(1)} fardo${p.estoque / fardoQtd !== 1 ? 's' : ''} em estoque` : ''}</div>` : '';
    const reporLabel    = hasDose && reposicaoModo === 'add' ? '+ Repor garrafas'
                        : hasFardo && reposicaoModo === 'add' ? '+ Repor fardos'
                        : '+ Repor';
    const reporPlaceholder = (hasDose && reposicaoModo === 'add')
      ? `Garrafas (1 garrafa = ${dosesPorGar} doses)`
      : (hasFardo && reposicaoModo === 'add')
      ? `Fardos (1 fardo = ${fardoQtd} un.)`
      : reposicaoModo === 'add' ? 'Qtd a adicionar…' : 'Qtd a retirar…';
    return `<div class="stock-item">
      <div class="stock-info">
        <div class="stock-name">${p.nome}</div>
        <div class="stock-sub">Venda ${fmt(p.preco)}${hasDose ? '/dose' : ''} · Custo ${fmt(p.custo)}${hasDose ? '/dose' : ''}</div>
        ${margem !== null ? `<div class="stock-margin">Margem: ${margem}%</div>` : ''}
        ${doseInfo}${fardoInfo}${comboInfo}
        <div class="stock-actions">
          <button class="stock-act-btn repor ${isRepondo && reposicaoModo==='add' ? 'active' : ''}" onclick="abrirReposicao(${p.id},'add')">${reporLabel}</button>
          <button class="stock-act-btn retirar ${isRepondo && reposicaoModo==='sub' ? 'active' : ''}" onclick="abrirReposicao(${p.id},'sub')">− Retirar</button>
          <button class="stock-act-btn edit" onclick="editarProduto(${p.id})">✏ Editar</button>
          <button class="stock-act-btn del"  onclick="excluirProduto(${p.id}, this)">Excluir</button>
        </div>
        ${isRepondo ? `<div class="repor-row">
          <input id="repor-inp-${p.id}" class="input repor-inp" type="number" min="1" placeholder="${reporPlaceholder}"
            onkeydown="if(event.key==='Enter')confirmarReposicao(${p.id})" />
          <button class="btn-repor-ok ${reposicaoModo==='sub' ? 'retirar' : ''}" onclick="confirmarReposicao(${p.id})">${reposicaoModo==='add' ? '✓ Adicionar' : '✓ Retirar'}</button>
        </div>` : ''}
      </div>
      <div class="stock-qty">
        <span class="stock-status-dot stock-dot-${dotClass}"></span>
        <span class="qty-num" style="${qtyColor}">${p.estoque}</span>
      </div>
    </div>`;
  }).join('');
}

function toggleReposicaoHistorico() {
  reposicaoHistoricoAberto = !reposicaoHistoricoAberto;
  const lista = document.getElementById('reposicao-lista');
  const btn   = document.getElementById('btn-repor-hist');
  if (lista) lista.style.display = reposicaoHistoricoAberto ? 'block' : 'none';
  if (btn)   btn.classList.toggle('open', reposicaoHistoricoAberto);
  if (reposicaoHistoricoAberto) carregarReposicoes();
}

async function carregarReposicoes() {
  const el = document.getElementById('reposicao-lista');
  if (!el) return;
  try {
    const rows = await apiFetch('/produtos/reposicoes');
    renderReposicoes(rows);
  } catch (e) { el.innerHTML = ''; }
}

function renderReposicoes(rows) {
  const el = document.getElementById('reposicao-lista');
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="empty-state" style="padding:1rem 0">Nenhuma reposição registrada</div>';
    return;
  }
  el.innerHTML = rows.map(r => {
    const qty = Number(r.quantidade);
    const isNeg = qty < 0;
    return `<div class="reposicao-item">
      <div class="rep-info">
        <span class="rep-nome">${r.produto_nome}</span>
        <span class="rep-hora">${fmtDataHora(r.criado_em)}</span>
      </div>
      <div class="rep-right">
        <span class="rep-qty" style="${isNeg ? 'color:var(--red)' : ''}">${isNeg ? qty : '+' + qty}</span>
        <span class="rep-op">${r.operador}</span>
      </div>
    </div>`;
  }).join('');
}

function abrirReposicao(id, modo = 'add') {
  fecharEditDrawer();
  if (reposicaoId === id && reposicaoModo === modo) {
    reposicaoId = null;
  } else {
    reposicaoId = id;
    reposicaoModo = modo;
  }
  renderEstoque();
  if (reposicaoId) setTimeout(() => document.getElementById(`repor-inp-${id}`)?.focus(), 50);
}

async function confirmarReposicao(id) {
  const val = parseInt(document.getElementById(`repor-inp-${id}`)?.value || '0');
  if (!val || val <= 0) return;
  const p = produtos.find(x => x.id === id);
  const hasDose     = !!(p?.dose_ml && p?.garrafa_ml);
  const dosesPorGar = hasDose ? Math.floor(Number(p.garrafa_ml) / Number(p.dose_ml)) : 1;
  const hasFardo    = Number(p?.unidades_por_fardo) >= 2;
  const fardoQtd    = hasFardo ? Number(p.unidades_por_fardo) : 1;
  let quantidade;
  if      (hasDose  && reposicaoModo === 'add') quantidade = val * dosesPorGar;
  else if (hasFardo && reposicaoModo === 'add') quantidade = val * fardoQtd;
  else                                          quantidade = val;
  const delta = reposicaoModo === 'sub' ? -quantidade : quantidade;
  try {
    const updated = await apiFetch(`/produtos/${id}/estoque`, { method: 'PATCH', body: JSON.stringify({ delta, registrar: true }) });
    const i = produtos.findIndex(x => x.id === id);
    if (i >= 0) produtos[i] = updated;
    reposicaoId = null;
    renderEstoque(); renderVenda();
    carregarReposicoes();
    const msg = hasDose && reposicaoModo === 'add'
      ? `+${val} garrafa${val > 1 ? 's' : ''} (${quantidade} doses) adicionadas`
      : hasFardo && reposicaoModo === 'add'
      ? `+${val} fardo${val > 1 ? 's' : ''} (${quantidade} un.) adicionados`
      : delta > 0 ? `+${quantidade} ${hasDose ? 'doses' : 'unidades'} adicionadas`
                  : `−${Math.abs(quantidade)} ${hasDose ? 'doses' : 'unidades'} retiradas`;
    showToast(msg, delta > 0 ? 'green-toast' : '');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

function editarProduto(id) {
  abrirEditDrawer(id);
}

function cancelarEdicao() {
  fecharEditDrawer();
}

function abrirEditDrawer(id) {
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  reposicaoId = null;
  editingId   = id;
  // Preenche os campos
  document.getElementById('ed-nome').value            = p.nome;
  document.getElementById('ed-cat').value             = p.categoria || '';
  document.getElementById('ed-preco').value           = fmtMoeda(p.preco);
  document.getElementById('ed-custo').value           = fmtMoeda(p.custo);
  document.getElementById('ed-estoque-display').value = p.estoque;
  document.getElementById('ed-min-stock').value       = p.estoque_minimo || '';
  document.getElementById('ed-fardo-qtd').value       = p.unidades_por_fardo || '';
  // Combo
  const hasCombo = !!(p.combo_qtd && p.combo_preco);
  document.getElementById('ed-combo-check').checked = hasCombo;
  document.getElementById('combo-row-ed').style.display = hasCombo ? 'grid' : 'none';
  document.getElementById('ed-combo-qtd').value   = hasCombo ? (p.combo_qtd  || '') : '';
  document.getElementById('ed-combo-preco').value = hasCombo ? (Number(p.combo_preco) * p.combo_qtd).toFixed(2) : '';
  // Dose
  const hasDose = !!(p.dose_ml && p.garrafa_ml);
  document.getElementById('ed-dose-check').checked = hasDose;
  document.getElementById('dose-row-ed').style.display = hasDose ? 'block' : 'none';
  document.getElementById('ed-garrafa-ml').value    = p.garrafa_ml    || '';
  document.getElementById('ed-dose-ml').value       = p.dose_ml       || '';
  document.getElementById('ed-garrafa-preco').value = p.garrafa_preco || '';
  if (hasDose) calcularDose('ed');
  else document.getElementById('dose-hint-ed').textContent = 'Preencha os ml da garrafa e da dose';
  // Botão salvar: reset
  const saveBtn = document.querySelector('#edit-drawer .btn-primary');
  if (saveBtn) { saveBtn.textContent = '✓ Salvar alterações'; saveBtn.disabled = false; }
  // Abre drawer
  document.getElementById('edit-drawer-bg').classList.add('open');
  document.getElementById('edit-drawer').classList.add('open');
  setTimeout(() => document.getElementById('ed-nome').focus(), 80);
}

function fecharEditDrawer() {
  document.getElementById('edit-drawer-bg').classList.remove('open');
  document.getElementById('edit-drawer').classList.remove('open');
  editingId = null;
}

async function salvarEdicaoDrawer() {
  const id = editingId;
  if (!id) return;
  const nome             = document.getElementById('ed-nome').value.trim();
  const preco            = lerMoeda('ed-preco');
  const custo            = lerMoeda('ed-custo');
  const categoria        = (document.getElementById('ed-cat')?.value || '').trim();
  const comboAtivo       = document.getElementById('ed-combo-check')?.checked;
  const comboQtdVal      = parseInt(document.getElementById('ed-combo-qtd')?.value);
  const comboPrecVal     = parseFloat(document.getElementById('ed-combo-preco')?.value);
  const estoqueMinimo    = parseInt(document.getElementById('ed-min-stock')?.value)  || 0;
  const unidadesPorFardo = parseInt(document.getElementById('ed-fardo-qtd')?.value)  || null;
  const doseAtivo        = document.getElementById('ed-dose-check')?.checked;
  const doseMlVal        = parseInt(document.getElementById('ed-dose-ml')?.value)    || null;
  const garrafaMlVal     = parseInt(document.getElementById('ed-garrafa-ml')?.value) || null;
  const garrafaPreco     = parseFloat(document.getElementById('ed-garrafa-preco')?.value) || null;
  if (!nome || isNaN(preco)) { showToast('⚠ Preencha nome e preço', 'error-toast'); return; }
  if (comboAtivo && (isNaN(comboQtdVal) || comboQtdVal < 2 || isNaN(comboPrecVal) || comboPrecVal <= 0)) {
    showToast('⚠ Preencha quantidade mínima (≥2) e preço do combo', 'error-toast'); return;
  }
  if (doseAtivo && (!doseMlVal || !garrafaMlVal)) {
    showToast('⚠ Preencha ml da garrafa e ml por dose', 'error-toast'); return;
  }
  const p      = produtos.find(x => x.id === id);
  const saveBtn = document.querySelector('#edit-drawer .btn-primary');
  if (saveBtn) { saveBtn.textContent = '…'; saveBtn.disabled = true; }
  try {
    const updated = await apiFetch(`/produtos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        nome, emoji: p.emoji, preco, custo, estoque: p.estoque,
        estoque_minimo: estoqueMinimo, categoria, unidades_por_fardo: unidadesPorFardo,
        combo_qtd:     comboAtivo ? comboQtdVal           : null,
        combo_preco:   comboAtivo ? comboPrecVal / comboQtdVal : null,
        dose_ml:       doseAtivo  ? doseMlVal      : null,
        garrafa_ml:    doseAtivo  ? garrafaMlVal   : null,
        garrafa_preco: doseAtivo  ? garrafaPreco   : null,
      })
    });
    const i = produtos.findIndex(x => x.id === id);
    if (i >= 0) produtos[i] = updated;
    fecharEditDrawer();
    renderEstoque();
    renderVenda();
    showToast('✓ ' + nome + ' atualizado!', 'green-toast');
  } catch (e) {
    if (saveBtn) { saveBtn.textContent = '✓ Salvar alterações'; saveBtn.disabled = false; }
    showToast('Erro: ' + e.message, 'error-toast');
  }
}

async function salvarEdicao(id) {
  const nome     = document.getElementById(`edit-nome-${id}`).value.trim();
  const preco    = lerMoeda(`edit-preco-${id}`);
  const custo    = lerMoeda(`edit-custo-${id}`);
  const categoria = (document.getElementById(`edit-cat-${id}`)?.value || '').trim();
  const comboAtivo  = document.getElementById(`combo-check-${id}`)?.checked;
  const comboQtdVal = parseInt(document.getElementById(`edit-combo-qtd-${id}`)?.value);
  const comboPrecVal = parseFloat(document.getElementById(`edit-combo-preco-${id}`)?.value);
  const estoqueMinimo    = parseInt(document.getElementById(`edit-min-stock-${id}`)?.value)  || 0;
  const unidadesPorFardo = parseInt(document.getElementById(`edit-fardo-qtd-${id}`)?.value)  || null;
  const doseAtivo        = document.getElementById(`dose-check-${id}`)?.checked;
  const doseMlVal    = parseInt(document.getElementById(`edit-dose-ml-${id}`)?.value)    || null;
  const garrafaMlVal = parseInt(document.getElementById(`edit-garrafa-ml-${id}`)?.value) || null;
  const garrafaPreco = parseFloat(document.getElementById(`edit-garrafa-preco-${id}`)?.value) || null;
  if (!nome || isNaN(preco)) { showToast('⚠ Preencha nome e preço', 'error-toast'); return; }
  if (comboAtivo && (isNaN(comboQtdVal) || comboQtdVal < 2 || isNaN(comboPrecVal) || comboPrecVal <= 0)) {
    showToast('⚠ Preencha quantidade mínima (≥2) e preço do combo', 'error-toast'); return;
  }
  if (doseAtivo && (!doseMlVal || !garrafaMlVal)) {
    showToast('⚠ Preencha ml da garrafa e ml por dose', 'error-toast'); return;
  }
  const p = produtos.find(x => x.id === id);
  try {
    const updated = await apiFetch(`/produtos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        nome, emoji: p.emoji, preco, custo, estoque: p.estoque, estoque_minimo: estoqueMinimo, categoria, unidades_por_fardo: unidadesPorFardo,
        combo_qtd:    comboAtivo ? comboQtdVal    : null,
        combo_preco:  comboAtivo ? comboPrecVal / comboQtdVal : null,
        dose_ml:      doseAtivo  ? doseMlVal      : null,
        garrafa_ml:   doseAtivo  ? garrafaMlVal   : null,
        garrafa_preco: doseAtivo ? garrafaPreco   : null
      })
    });
    const i = produtos.findIndex(x => x.id === id);
    if (i >= 0) produtos[i] = updated;
    editingId = null;
    renderEstoque();
    renderVenda();
    showToast('✓ ' + nome + ' atualizado!', 'green-toast');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

async function excluirProduto(id, btn) {
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Confirmar?';
    btn._timer = setTimeout(() => { btn.classList.remove('confirming'); btn.textContent = 'Excluir'; }, 3000);
    return;
  }
  clearTimeout(btn._timer);
  btn.textContent = '…'; btn.disabled = true;
  try {
    await apiFetch(`/produtos/${id}`, { method: 'DELETE' });
    produtos = produtos.filter(p => p.id !== id);
    renderEstoque(); renderVenda();
    showToast('Produto removido', 'green-toast');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error-toast');
    btn.classList.remove('confirming'); btn.textContent = 'Excluir'; btn.disabled = false;
  }
}

async function ajustarEstoque(id, delta) {
  try {
    const a = await apiFetch(`/produtos/${id}/estoque`, { method: 'PATCH', body: JSON.stringify({ delta }) });
    const i = produtos.findIndex(p => p.id === id);
    if (i >= 0) produtos[i] = a;
    renderEstoque(); renderVenda();
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

/* ── Margem ao vivo ───────────────────────── */
function atualizarMargem() {
  const preco = lerMoeda('new-price');
  const custo = lerMoeda('new-cost');
  const hint  = document.getElementById('margin-hint');
  if (!isNaN(preco) && !isNaN(custo) && preco > 0) {
    const margem   = Math.round(((preco - custo) / preco) * 100);
    const lucroUnit = (preco - custo).toFixed(2).replace('.', ',');
    hint.textContent = `Margem: ${margem}% (R$${lucroUnit})`;
    hint.style.color = margem >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    hint.textContent  = 'Margem: —';
    hint.style.color  = 'var(--green)';
  }
}

/* Enter avança campos do formulário */
function setupFormEnter() {
  const campos = ['new-name', 'new-price', 'new-cost', 'new-qty'];
  campos.forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const prox = campos[i + 1] ? document.getElementById(campos[i + 1]) : null;
      if (prox) prox.focus();
      else addProduto();
    });
  });
}

async function addProduto() {
  const nome       = document.getElementById('new-name').value.trim();
  const preco      = lerMoeda('new-price');
  const custo      = lerMoeda('new-cost');
  const categoria  = (document.getElementById('new-cat')?.value || '').trim();
  const comboAtivo   = document.getElementById('new-combo-check')?.checked;
  const comboQtdVal  = parseInt(document.getElementById('new-combo-qtd')?.value);
  const comboPrecVal = parseFloat(document.getElementById('new-combo-preco')?.value);
  const estoqueMinimo    = parseInt(document.getElementById('new-min-stock')?.value)  || 0;
  const unidadesPorFardo = parseInt(document.getElementById('new-fardo-qtd')?.value)   || null;
  const doseAtivo        = document.getElementById('new-dose-check')?.checked;
  const doseMlVal    = parseInt(document.getElementById('new-dose-ml')?.value)    || null;
  const garrafaMlVal = parseInt(document.getElementById('new-garrafa-ml')?.value) || null;
  const garrafaPreco = parseFloat(document.getElementById('new-garrafa-preco')?.value) || null;
  if (!nome) { showToast('⚠ Informe o nome do produto', 'error-toast'); return; }
  if (comboAtivo && (isNaN(comboQtdVal) || comboQtdVal < 2 || isNaN(comboPrecVal) || comboPrecVal <= 0)) {
    showToast('⚠ Preencha quantidade mínima (≥2) e preço do combo', 'error-toast'); return;
  }
  if (doseAtivo && (!doseMlVal || !garrafaMlVal)) {
    showToast('⚠ Preencha ml da garrafa e ml por dose', 'error-toast'); return;
  }
  // Converte garrafas/fardos → unidades ao cadastrar
  let estoqueRaw = parseInt(document.getElementById('new-qty').value) || 0;
  let estoque = estoqueRaw;
  if (doseAtivo && garrafaMlVal && doseMlVal) {
    estoque = estoqueRaw * Math.floor(garrafaMlVal / doseMlVal);
  } else if (unidadesPorFardo >= 2) {
    estoque = estoqueRaw * unidadesPorFardo;
  }
  try {
    const novo = await apiFetch('/produtos', { method: 'POST', body: JSON.stringify({
      nome, preco, custo, estoque, estoque_minimo: estoqueMinimo, categoria, unidades_por_fardo: unidadesPorFardo,
      combo_qtd:    comboAtivo ? comboQtdVal    : null,
      combo_preco:  comboAtivo ? comboPrecVal / comboQtdVal : null,
      dose_ml:      doseAtivo  ? doseMlVal      : null,
      garrafa_ml:   doseAtivo  ? garrafaMlVal   : null,
      garrafa_preco: doseAtivo ? garrafaPreco   : null
    }) });
    produtos.push(novo);
    ['new-name', 'new-cat', 'new-price', 'new-cost', 'new-qty', 'new-min-stock', 'new-fardo-qtd',
     'new-combo-qtd', 'new-combo-preco', 'new-garrafa-ml', 'new-dose-ml', 'new-garrafa-preco'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const comboCheck = document.getElementById('new-combo-check');
    if (comboCheck) comboCheck.checked = false;
    const comboRow = document.getElementById('combo-row-new');
    if (comboRow) comboRow.style.display = 'none';
    const doseCheck = document.getElementById('new-dose-check');
    if (doseCheck) doseCheck.checked = false;
    toggleDoseRow('new'); // reseta row + placeholder do qty
    atualizarPlaceholderQty(); // garante reset do placeholder de fardo
    document.getElementById('margin-hint').textContent = 'Margem: —';
    document.getElementById('dose-hint-new').textContent = 'Preencha os ml da garrafa e da dose';
    renderEstoque(); renderVenda();
    showToast('✓ ' + nome + ' adicionado!', 'green-toast');
    fecharAddDrawer();
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

/* ── Carrinho ─────────────────────────────── */
function setQtyCarrinho(id, qty) {
  const p = produtos.find(x => x.id === id);
  if (!p) return;
  const safe = Math.min(Math.max(0, qty), p.estoque);
  if (safe === 0) {
    carrinho = carrinho.filter(c => c.id !== id);
  } else {
    const ex = carrinho.find(c => c.id === id);
    if (ex) ex.qty = safe;
    else carrinho.push({ id, qty: safe });
  }
  if (safe < qty) showToast(`⚠ Só ${p.estoque} em estoque`, 'error-toast');
  vibrar(25);
  flashCard(id);
  renderCarrinho();
}

function addCarrinho(id) {
  const p = produtos.find(x => x.id === id);
  if (!p || p.estoque === 0) return;
  const ex = carrinho.find(c => c.id === id);
  if (ex && ex.qty >= p.estoque) { showToast('⚠ Estoque insuficiente'); return; }
  setQtyCarrinho(id, (ex?.qty || 0) + 1);
}

function removeCarrinho(id) {
  const ex = carrinho.find(c => c.id === id);
  if (ex) setQtyCarrinho(id, ex.qty - 1);
}

function removeAllCarrinho(id) {
  carrinho = carrinho.filter(c => c.id !== id);
  renderCarrinho();
}

function limparCarrinho() { carrinho = []; renderCarrinho(); }

function limparCarrinhoConfirm() {
  const btn = document.getElementById('cart-bar-clear');
  if (!btn) return;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Confirmar?';
    btn._timer = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.textContent = 'Limpar';
    }, 3000);
    return;
  }
  clearTimeout(btn._timer);
  btn.classList.remove('confirming');
  btn.textContent = 'Limpar';
  limparCarrinho();
}

function limparCarrinhoConfirmSidebar() {
  const btn = document.getElementById('cs-btn-clear');
  if (!btn) return;
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = '⚠ Confirmar?';
    btn._timer = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.textContent = '🗑 Limpar carrinho';
    }, 3000);
    return;
  }
  clearTimeout(btn._timer);
  btn.classList.remove('confirming');
  btn.textContent = '🗑 Limpar carrinho';
  limparCarrinho();
}

function atualizarCartBar() {
  const bar     = document.getElementById('cart-bar');
  const badge   = document.getElementById('cart-badge');
  const infoBtn = document.getElementById('cart-bar-info');
  const isVenda = document.getElementById('tab-venda').classList.contains('active');
  const totalItens = carrinho.reduce((s, c) => s + c.qty, 0);

  if (badge) {
    if (totalItens > 0) {
      badge.textContent = totalItens > 9 ? '9+' : totalItens;
      badge.classList.add('show');
      badge.classList.remove('bounce');
      void badge.offsetWidth;
      badge.classList.add('bounce');
      badge.addEventListener('animationend', () => badge.classList.remove('bounce'), { once: true });
    } else badge.classList.remove('show');
  }

  if (!bar) return;
  if (!totalItens || !isVenda) {
    bar.classList.remove('visible');
    cartSheetOpen = false;
    document.getElementById('cart-drawer')?.classList.remove('open');
    document.getElementById('cart-drawer-bg')?.classList.remove('open');
    return;
  }

  const total = totalCarrinho();
  if (infoBtn) {
    infoBtn.innerHTML = `${totalItens} ${totalItens === 1 ? 'item' : 'itens'} · ${fmt(total)}`;
  }
  bar.classList.add('visible');
}

function atualizarCartSidebar() {
  if (window.innerWidth <= 620) return;
  const itemsEl  = document.getElementById('cs-items');
  const emptyEl  = document.getElementById('cs-empty');
  const footerEl = document.getElementById('cs-footer');
  const totalEl  = document.getElementById('cs-total');
  if (!itemsEl || !emptyEl || !footerEl) return;

  const totalItens = carrinho.reduce((s, c) => s + c.qty, 0);

  if (!totalItens) {
    itemsEl.innerHTML = '';
    emptyEl.style.display = '';
    footerEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  footerEl.style.display = '';
  if (totalEl) totalEl.textContent = fmt(totalCarrinho());

  itemsEl.innerHTML = carrinho.map(c => {
    const p = produtos.find(x => x.id === c.id);
    if (!p) return '';
    const comboActive = !venderAoCusto && p.combo_qtd && p.combo_preco && c.qty >= p.combo_qtd;
    const precoUnit   = comboActive ? Number(p.combo_preco) : (venderAoCusto ? (p.custo || 0) : p.preco);
    const subtotal    = precoUnit * c.qty;
    return `<div class="cs-sidebar-item">
      <div class="css-info">
        <span class="css-name">${p.nome}</span>
        <span class="css-price">${fmt(subtotal)}</span>
      </div>
      <div class="css-controls">
        <button class="css-ctrl" onclick="removeCarrinho(${c.id})">−</button>
        <span class="css-qty">${c.qty}</span>
        <button class="css-ctrl" onclick="addCarrinho(${c.id})">+</button>
      </div>
    </div>`;
  }).join('');
}

function renderCartSheet() {
  const el = document.getElementById('cart-sheet-items');
  if (!el) return;
  el.innerHTML = carrinho.map(c => {
    const p = produtos.find(x => x.id === c.id);
    const comboActive = !venderAoCusto && p.combo_qtd && p.combo_preco && c.qty >= p.combo_qtd;
    const precoUnit   = comboActive ? Number(p.combo_preco) : (venderAoCusto ? (p.custo || 0) : p.preco);
    const total       = precoUnit * c.qty;
    const comboLabel  = comboActive
      ? ` <span class="cs-combo">Combo! ${p.combo_qtd} un. por ${fmt(Number(p.combo_preco) * p.combo_qtd)}</span>` : '';
    return `<div class="cs-item">
      <span class="cs-name">${p.nome}${comboLabel}</span>
      <div class="cs-controls">
        <button class="cs-ctrl" onclick="removeCarrinho(${c.id})">−</button>
        <span class="cs-qty" id="csq-${c.id}" onclick="editQtyInline(${c.id})" title="Toque para editar">${c.qty}</span>
        <button class="cs-ctrl" onclick="addCarrinho(${c.id})">+</button>
      </div>
      <span class="cs-price">${fmt(total)}</span>
    </div>`;
  }).join('');
  // Atualiza header e footer do drawer
  const totalItens = carrinho.reduce((s, c) => s + c.qty, 0);
  const cntEl = document.getElementById('cart-drawer-cnt');
  const totalEl = document.getElementById('cart-drawer-total-val');
  if (cntEl) cntEl.textContent = `${totalItens} ${totalItens === 1 ? 'item' : 'itens'}`;
  if (totalEl) totalEl.textContent = fmt(totalCarrinho());
}

function editQtyInline(id) {
  const el = document.getElementById('csq-' + id);
  if (!el || el.querySelector('input')) return;
  const p   = produtos.find(x => x.id === id);
  const cur = carrinho.find(c => c.id === id)?.qty || 1;
  el.innerHTML = `<input class="cs-qty-inp" type="number" min="0" max="${p?.estoque || 99}" value="${cur}"
    onkeydown="if(event.key==='Enter')this.blur();if(event.key==='Escape')renderCarrinho()"
    onblur="salvarQtyInline(${id},this)" />`;
  const inp = el.querySelector('input');
  inp.focus(); inp.select();
}

function salvarQtyInline(id, inp) {
  const v = parseInt(inp.value);
  if (!isNaN(v)) setQtyCarrinho(id, v);
  else renderCarrinho();
}

function toggleCartSheet() {
  if (!carrinho.length) return;
  cartSheetOpen = !cartSheetOpen;
  if (cartSheetOpen) {
    renderCartSheet();
    document.getElementById('cart-drawer')?.classList.add('open');
    document.getElementById('cart-drawer-bg')?.classList.add('open');
  } else {
    document.getElementById('cart-drawer')?.classList.remove('open');
    document.getElementById('cart-drawer-bg')?.classList.remove('open');
  }
  atualizarCartBar();
}

function fecharCartDrawer() {
  if (!cartSheetOpen) return;
  cartSheetOpen = false;
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-drawer-bg')?.classList.remove('open');
  atualizarCartBar();
}

/* ── Drawer Adicionar Produto ─────────────── */
function abrirAddDrawer() {
  document.getElementById('add-drawer')?.classList.add('open');
  document.getElementById('add-drawer-bg')?.classList.add('open');
  setTimeout(() => document.getElementById('new-name')?.focus(), 180);
}

function fecharAddDrawer() {
  document.getElementById('add-drawer')?.classList.remove('open');
  document.getElementById('add-drawer-bg')?.classList.remove('open');
}

/* Atualiza apenas badges e classes dos cards existentes (sem re-renderizar tudo) */
function updateCarrinhoVendaCards() {
  document.querySelectorAll('.produto-card[data-id]').forEach(card => {
    const id   = Number(card.dataset.id);
    const item = carrinho.find(c => c.id === id);
    const p    = produtos.find(x => x.id === id);
    const badge = card.querySelector('.pc-badge');
    if (item && item.qty > 0) {
      card.classList.add('in-cart');
      if (badge) { badge.style.display = ''; badge.textContent = item.qty; }
      const comboOn = p && p.combo_qtd && p.combo_preco && item.qty >= p.combo_qtd;
      card.classList.toggle('combo-active', !!comboOn);
    } else {
      card.classList.remove('in-cart', 'combo-active');
      if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
    }
  });
}

function renderCarrinho() {
  const clearBtn = document.getElementById('cart-bar-clear');
  if (clearBtn?.classList.contains('confirming')) {
    clearTimeout(clearBtn._timer);
    clearBtn.classList.remove('confirming');
    clearBtn.textContent = 'Limpar';
  }
  if (cartSheetOpen) {
    if (!carrinho.length) {
      fecharCartDrawer();
    } else {
      renderCartSheet();
    }
  }
  updateCarrinhoVendaCards();
  atualizarCartBar();
}

/* ── Pagamento ────────────────────────────── */
function totalCarrinho() {
  return carrinho.reduce((s, c) => {
    const p = produtos.find(x => x.id === c.id);
    if (!venderAoCusto && p.combo_qtd && p.combo_preco && c.qty >= p.combo_qtd) {
      return s + Number(p.combo_preco) * c.qty;
    }
    return s + (venderAoCusto ? (p.custo || 0) : p.preco) * c.qty;
  }, 0);
}

function abrirPagamento() {
  if (!carrinho.length) return;
  venderAoCusto = false;
  atualizarModalCusto();
  document.getElementById('pm-recebido').value = '';
  document.getElementById('pm-troco').textContent = '';
  selecionarPagamento('dinheiro');
  document.getElementById('pay-overlay').classList.add('open');
  document.getElementById('pay-modal').classList.add('open');
}

function toggleCustoMode() {
  venderAoCusto = !venderAoCusto;
  atualizarModalCusto();
  document.getElementById('pm-recebido').value = '';
  document.getElementById('pm-troco').textContent = '';
}

function atualizarModalCusto() {
  const total  = totalCarrinho();
  const btn    = document.getElementById('btn-custo');
  const pmTotal = document.getElementById('pm-total');
  btn.classList.toggle('active', venderAoCusto);
  btn.textContent = venderAoCusto ? '✓ Vendendo ao custo' : 'Vender ao custo';
  pmTotal.textContent = fmt(total);
  pmTotal.style.color = venderAoCusto ? 'var(--muted)' : '';
}

function fecharPagamento() {
  document.getElementById('pay-overlay').classList.remove('open');
  document.getElementById('pay-modal').classList.remove('open');
}

function selecionarPagamento(metodo) {
  metodoPagamento = metodo;
  document.querySelectorAll('.pay-method-btn').forEach(b => b.classList.toggle('active', b.dataset.method === metodo));
  document.getElementById('pm-troco-row').style.display = metodo === 'dinheiro' ? 'block' : 'none';
  if (metodo === 'dinheiro') setTimeout(() => document.getElementById('pm-recebido').focus(), 50);
}

function setRecebido(valor) {
  document.getElementById('pm-recebido').value = fmtMoeda(valor);
  calcularTroco();
}

function calcularTroco() {
  const recebido = lerMoeda('pm-recebido');
  const total    = totalCarrinho();
  const el       = document.getElementById('pm-troco');
  if (recebido <= 0) { el.textContent = ''; return; }
  const troco = recebido - total;
  el.textContent  = troco >= 0 ? `Troco: ${fmt(troco)}` : `Faltam: ${fmt(-troco)}`;
  el.style.color  = troco >= 0 ? 'var(--green)' : 'var(--red)';
}

function confirmarVenda() {
  fecharPagamento();
  finalizarVenda();
}

async function finalizarVenda() {
  if (!carrinho.length) return;
  const total = totalCarrinho();
  const itens = carrinho.map(c => ({ produto_id: c.id, quantidade: c.qty }));
  try {
    const venda = await apiFetch('/vendas', { method: 'POST', body: JSON.stringify({ itens, forma_pagamento: metodoPagamento, operador: operadorAtual, ao_custo: venderAoCusto }) });
    venderAoCusto = false;
    vibrar([40, 20, 40]);
    mostrarSuccessAnim();
    ultimaVendaId = venda.id;
    carrinho = [];
    renderCarrinho();
    await carregarProdutos();
    await carregarResumo();
    showToast('✓ ' + fmt(total) + ' registrado!', 'green-toast');
    mostrarDesfazer(total);
  } catch (e) {
    const isNetwork = e.message.includes('fetch') || e.message.includes('Failed') || e.message.includes('network');
    showToast(isNetwork ? '⚠ Sem conexão — carrinho mantido, tente novamente' : 'Erro: ' + e.message, 'error-toast');
  }
}

/* ── Animação de sucesso ──────────────────── */
function mostrarSuccessAnim() {
  const el = document.getElementById('success-anim');
  if (!el) return;
  el.style.opacity = '';
  el.style.transition = '';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => {
    el.style.transition = 'opacity .35s';
    el.style.opacity = '0';
    setTimeout(() => { el.classList.remove('show'); el.style.transition = ''; el.style.opacity = ''; }, 350);
  }, 700);
}

/* ── Desfazer ─────────────────────────────── */
function mostrarDesfazer(total) {
  const bar = document.getElementById('undo-bar');
  if (!bar) return;
  document.getElementById('undo-msg').textContent = fmt(total) + ' registrado';
  bar.classList.add('show');
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { bar.classList.remove('show'); ultimaVendaId = null; }, 12000);
}

async function desfazerUltimaVenda() {
  if (!ultimaVendaId) return;
  clearTimeout(undoTimer);
  document.getElementById('undo-bar')?.classList.remove('show');
  const id = ultimaVendaId;
  ultimaVendaId = null;
  try {
    await apiFetch(`/vendas/${id}`, { method: 'DELETE' });
    await carregarProdutos();
    await carregarResumo();
    showToast('Venda desfeita', 'green-toast');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

/* ── Resumo / Relatório / Histórico ──────── */
async function carregarResumo() {
  try {
    const r = await apiFetch('/vendas/resumo');
    countUp(document.getElementById('m-vendas'),    r.total_vendas,      v => String(Math.round(v)));
    countUp(document.getElementById('m-total'),     r.total_arrecadado,  fmtShort);
    countUp(document.getElementById('m-lucro'),     r.total_lucro,       fmtShort);
    countUp(document.getElementById('h-vendas'),    r.total_vendas,      v => String(Math.round(v)));
    countUp(document.getElementById('h-total'),     r.total_arrecadado,  fmtShort);
    countUp(document.getElementById('h-ticket'),    r.ticket_medio,      fmtShort);
    countUp(document.getElementById('cs-m-vendas'), r.total_vendas,      v => String(Math.round(v)));
    countUp(document.getElementById('cs-m-total'),  r.total_arrecadado,  fmtShort);
    countUp(document.getElementById('cs-m-lucro'),  r.total_lucro,       fmtShort);
  } catch {}
}

async function carregarRelatorio() {
  const l = document.getElementById('relatorio-lista');
  renderSkeleton('relatorio-lista', 5, 'list');
  try {
    const [itens, resumo, vendas, porOperador] = await Promise.all([
      apiFetch('/vendas/relatorio'), apiFetch('/vendas/resumo'), apiFetch('/vendas'),
      apiFetch('/vendas/por-operador')
    ]);
    relatorioItens = itens;
    historicoVendas = vendas;
    itens.forEach(i => { vendidoMap[i.id] = Number(i.qtd_vendida); });

    countUp(document.getElementById('r-total'), resumo.total_arrecadado, fmtShort);
    countUp(document.getElementById('r-lucro'), resumo.total_lucro,      fmtShort);
    const margemNum = resumo.total_arrecadado > 0
      ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) : 0;
    if (resumo.total_arrecadado > 0)
      countUp(document.getElementById('r-margem'), margemNum, v => Math.round(v) + '%');
    else
      document.getElementById('r-margem').textContent = '—';
    const pag = resumo.pagamentos || {};
    dinheiroVendas = Number(pag.dinheiro) || 0;
    countUp(document.getElementById('r-dinheiro'), pag.dinheiro || 0, fmtShort);
    countUp(document.getElementById('r-pix'),      pag.pix      || 0, fmtShort);
    countUp(document.getElementById('r-cartao'),   pag.cartao   || 0, fmtShort);

    const custoDiv = document.getElementById('custo-resumo');
    const nCusto = Number(resumo.vendas_custo) || 0;
    if (nCusto > 0) {
      const recNormal = Number(resumo.arrecadado_normal) || 0;
      const recCusto  = Number(resumo.arrecadado_custo)  || 0;
      const nNormal   = Number(resumo.vendas_normal) || 0;
      custoDiv.innerHTML = `<div class="custo-resumo-card">
        <div class="cr-title">⚠ Inclui vendas ao preço de custo</div>
        <div class="cr-row"><span class="cr-label">Vendas ao preço normal</span><span class="cr-val">${nNormal} venda${nNormal !== 1 ? 's' : ''} · ${fmt(recNormal)}</span></div>
        <div class="cr-row"><span class="cr-label">Vendas ao preço de custo</span><span class="cr-val red">${nCusto} venda${nCusto !== 1 ? 's' : ''} · ${fmt(recCusto)}</span></div>
      </div>`;
    } else {
      custoDiv.innerHTML = '';
    }

    renderRelatorioLista();
    renderVendasPorHora(vendas);
    renderOperadorLista(porOperador);
    carregarFundo();
  } catch (e) { l.innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`; }
}

function renderOperadorLista(data) {
  const el = document.getElementById('operador-lista');
  if (!el) return;
  if (!data || data.length <= 1) { el.innerHTML = ''; return; }
  const totalGeral = data.reduce((s, op) => s + Number(op.total_arrecadado), 0);
  el.innerHTML = data.map(op => {
    const pct = totalGeral > 0 ? Math.round((Number(op.total_arrecadado) / totalGeral) * 100) : 0;
    return `<div class="operador-card">
      <div class="op-top">
        <span class="op-nome">${op.operador || 'Caixa'}</span>
        <span class="op-total">${fmt(op.total_arrecadado)}</span>
      </div>
      <div class="op-bar-wrap">
        <div class="op-bar" style="width:${pct}%"></div>
      </div>
      <div class="op-bottom">
        <span class="op-vendas">${op.total_vendas} venda${op.total_vendas !== 1 ? 's' : ''}</span>
        <span class="op-pct">${pct}%</span>
      </div>
    </div>`;
  }).join('');
}

function renderRelatorioLista() {
  const l = document.getElementById('relatorio-lista');
  if (!relatorioItens) return;
  if (!relatorioItens.length || relatorioItens.every(i => i.qtd_vendida == 0)) {
    l.innerHTML = '<div class="empty-state">📊<br/>Nenhuma venda registrada ainda</div>';
    return;
  }
  const sorted = [...relatorioItens].sort((a, b) => {
    if (sortRelatorio === 'az')    return a.nome.localeCompare(b.nome, 'pt-BR');
    if (sortRelatorio === 'lucro') return Number(b.lucro) - Number(a.lucro);
    return Number(b.qtd_vendida) - Number(a.qtd_vendida);
  });
  const maxReceita = Math.max(...sorted.map(i => Number(i.receita)), 1);
  l.innerHTML = sorted.map((item, idx) => {
    const receita    = Number(item.receita);
    const lucro      = Number(item.lucro);
    const custoTotal = Number(item.custo_total);
    const qtdCusto   = Number(item.qtd_custo  || 0);
    const recNormal  = Number(item.receita_normal || 0);
    const recCusto   = Number(item.receita_custo  || 0);
    const pct        = Math.max(0, Math.min(100, Math.round((receita / maxReceita) * 100)));
    const isNeg      = lucro < 0;
    const badgeCusto = qtdCusto > 0 ? `<span class="badge-custo">${qtdCusto} ao custo</span>` : '';
    const receitaDetalhe = qtdCusto > 0
      ? `<div class="rb-split"><span>${fmt(recNormal)} normal</span><span class="red">${fmt(recCusto)} custo</span></div>`
      : '';
    const rankNum  = idx + 1;
    const rankClass = rankNum <= 3 ? `rel-rank-${rankNum}` : 'rel-rank-n';
    const rankBadge = `<span class="rel-rank ${rankClass}">${rankNum <= 3 ? '#' + rankNum : rankNum}</span>`;
    return `<div class="relatorio-item">
      <div class="rel-header">
        ${rankBadge}
        <span class="rel-nome">${item.nome}</span>
        <span class="rel-qtd">${item.qtd_vendida} vendidos${badgeCusto}</span>
      </div>
      <div class="rel-grid">
        <div class="rel-box"><div class="rb-label">Receita</div><div class="rb-val">${fmt(receita)}</div>${receitaDetalhe}</div>
        <div class="rel-box custo"><div class="rb-label">Custo</div><div class="rb-val">${fmt(custoTotal)}</div></div>
        <div class="rel-box lucro"><div class="rb-label">Lucro</div><div class="rb-val" style="${isNeg ? 'color:var(--red)' : ''}">${fmt(lucro)}</div></div>
      </div>
      <div class="rel-bar-wrap"><div class="rel-bar ${isNeg ? 'negativo' : ''}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderVendasPorHora(vendas) {
  const el = document.getElementById('grafico-hora');
  if (!el) return;
  if (!vendas || !vendas.length) { el.innerHTML = '<div class="empty-state" style="padding:.75rem">Nenhuma venda ainda</div>'; return; }
  const porHora = {};
  vendas.forEach(v => {
    const h = parseDataUTC(v.criado_em)
      .toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
      .split(':')[0].replace(/\D/g, '').padStart(2, '0');
    if (!porHora[h]) porHora[h] = 0;
    porHora[h]++;
  });
  const horas = Object.keys(porHora).sort();
  const maxQtd = Math.max(...horas.map(h => porHora[h]));

  // Calcula hora de pico
  const picoHora   = horas.reduce((best, h) => porHora[h] > porHora[best] ? h : best, horas[0]);
  const picoVendas = porHora[picoHora];
  const totalVendas = horas.reduce((s, h) => s + porHora[h], 0);
  const picoHtml = `<div class="gh-pico">
    <span class="gh-pico-icon">⚡</span>
    Pico às <strong>${picoHora}h</strong> · ${picoVendas} ${picoVendas === 1 ? 'venda' : 'vendas'} · ${totalVendas} no total
  </div>`;

  el.innerHTML = picoHtml + horas.map(h => {
    const pct     = Math.max(3, Math.round((porHora[h] / maxQtd) * 100));
    const isPico  = h === picoHora;
    return `<div class="gh-row">
      <span class="gh-hora">${h}h</span>
      <div class="gh-bar-h-wrap"><div class="gh-bar-h" style="width:${pct}%;${isPico ? 'background:var(--amber-d)' : ''}"></div></div>
      <span class="gh-count" style="${isPico ? 'color:var(--amber-d);font-weight:800' : ''}">${porHora[h]}</span>
    </div>`;
  }).join('');
}

async function deletarVenda(id, btn) {
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Confirmar?';
    btn._timer = setTimeout(() => { btn.classList.remove('confirming'); btn.textContent = '🗑'; btn.style.fontSize = ''; }, 3000);
    return;
  }
  clearTimeout(btn._timer);
  btn.textContent = '…'; btn.disabled = true;
  try {
    await apiFetch(`/vendas/${id}`, { method: 'DELETE' });
    historicoVendas = historicoVendas?.filter(v => v.id !== id);
    renderHistoricoLista();
    await carregarProdutos();
    await carregarResumo();
    showToast('Venda removida', 'green-toast');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error-toast');
    btn.classList.remove('confirming'); btn.textContent = '🗑'; btn.disabled = false;
  }
}

async function carregarHistorico() {
  const l = document.getElementById('historico-lista');
  renderSkeleton('historico-lista', 5, 'list');
  try {
    const v = await apiFetch('/vendas');
    await carregarResumo();
    historicoVendas = v;
    renderHistoricoLista();
  } catch (e) { l.innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`; }
}

function renderHistoricoLista() {
  const l = document.getElementById('historico-lista');
  if (!historicoVendas) return;
  const v = historicoVendas;
  if (!v.length) { l.innerHTML = '<div class="empty-state">🧾<br/>Nenhuma venda ainda</div>'; return; }

  const sorted = sortHistorico === 'valor'
    ? [...v].sort((a, b) => Number(b.total) - Number(a.total))
    : [...v];

  // Filtro por texto
  const busca = (document.getElementById('busca-historico')?.value || '').trim().toLowerCase();
  let filtrado = busca
    ? sorted.filter(venda =>
        (venda.descricao || '').toLowerCase().includes(busca) ||
        (venda.operador  || '').toLowerCase().includes(busca) ||
        (venda.forma_pagamento || '').toLowerCase().includes(busca))
    : sorted;

  // Filtro por forma de pagamento
  if (filtroPagamento) {
    filtrado = filtrado.filter(venda => (venda.forma_pagamento || 'dinheiro') === filtroPagamento);
  }
  // Filtro por operador
  if (filtroOperador) {
    filtrado = filtrado.filter(venda => venda.operador === filtroOperador);
  }
  atualizarSelectOperador();

  if (!filtrado.length) {
    l.innerHTML = '<div class="empty-state">Nenhuma venda encontrada</div>';
    return;
  }

  const totalPags = Math.ceil(filtrado.length / HIST_POR_PAG);
  histPagina = Math.min(histPagina, totalPags);
  const inicio = (histPagina - 1) * HIST_POR_PAG;
  const pagina = filtrado.slice(inicio, inicio + HIST_POR_PAG);

  // Contagem por hora (sobre todos os filtrados, não só a página atual)
  const countPorHora = {};
  if (sortHistorico === 'recente') {
    filtrado.forEach(venda => {
      const h = parseDataUTC(venda.criado_em)
        .toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
        .split(':')[0].replace(/\D/g, '').padStart(2, '0');
      countPorHora[h] = (countPorHora[h] || 0) + 1;
    });
  }

  const labelPag = { dinheiro: '💵 Dinheiro', pix: 'Pix', cartao: '💳 Cartão' };
  const pagClass  = { dinheiro: 'pag-dinheiro', pix: 'pag-pix', cartao: 'pag-cartao' };

  let itensHtml = '';
  let lastHora  = null;

  pagina.forEach(venda => {
    // Separador de hora (só quando ordem é "Recente")
    if (sortHistorico === 'recente') {
      const hora = parseDataUTC(venda.criado_em)
        .toLocaleString('pt-BR', { hour: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' })
        .split(':')[0].replace(/\D/g, '').padStart(2, '0');
      if (hora !== lastHora) {
        const cnt = countPorHora[hora];
        const mt  = lastHora === null ? 'margin-top:0' : 'margin-top:14px';
        itensHtml += `<div class="hist-hora-sep" style="${mt}">
          <span class="hist-hora-sep-label">${hora}h</span>
          <span class="hist-hora-sep-line"></span>
          <span class="hist-hora-sep-count">${cnt} ${cnt === 1 ? 'venda' : 'vendas'}</span>
        </div>`;
        lastHora = hora;
      }
    }

    const num = v.length - v.findIndex(x => x.id === venda.id);
    const pag = venda.forma_pagamento || 'dinheiro';
    itensHtml += `<div class="historico-item" id="hist-${venda.id}">
      <span class="hist-num">#${num}</span>
      <div class="hist-info">
        <div class="hist-desc">${venda.descricao}</div>
        <div class="hist-hora">${fmtDataHora(venda.criado_em)}</div>
      </div>
      <div class="hist-right">
        <span class="hist-total">${fmt(venda.total)}</span>
        <span class="hist-pag ${pagClass[pag] || ''}">${labelPag[pag] || pag}</span>
        ${venda.operador ? `<span class="hist-operador">${venda.operador}</span>` : ''}
        <button class="hist-del" onclick="deletarVenda(${venda.id}, this)" title="Excluir venda">🗑</button>
      </div>
    </div>`;
  });

  const paginacaoHtml = totalPags > 1 ? `
    <div class="hist-paginacao">
      <button class="hist-pag-btn" onclick="setHistPagina(${histPagina - 1})" ${histPagina <= 1 ? 'disabled' : ''}>← Anterior</button>
      <span class="hist-pag-info">${histPagina} / ${totalPags}</span>
      <button class="hist-pag-btn" onclick="setHistPagina(${histPagina + 1})" ${histPagina >= totalPags ? 'disabled' : ''}>Próxima →</button>
    </div>` : '';

  l.innerHTML = itensHtml + paginacaoHtml;
}

function setHistPagina(n) {
  histPagina = n;
  renderHistoricoLista();
  document.getElementById('tab-historico').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Seletor de Quantidade ────────────────── */
function abrirQtyPicker(id) {
  const p = produtos.find(x => x.id === id);
  if (!p || p.estoque === 0) return;
  qtyPickerId = id;
  document.getElementById('qm-nome').textContent    = p.nome;
  document.getElementById('qm-estoque').textContent = `${p.estoque} em estoque · R$${(p.preco).toFixed(2).replace('.',',')} cada`;
  qmCurrentVal = '';
  const display = document.getElementById('qm-display');
  if (display) display.textContent = '0';
  document.getElementById('qty-overlay').classList.add('open');
  document.getElementById('qty-modal').classList.add('open');
}

function qmNumpad(key) {
  if (key === 'clear') {
    qmCurrentVal = '';
  } else if (key === 'del') {
    qmCurrentVal = qmCurrentVal.slice(0, -1);
  } else {
    if (qmCurrentVal.length >= 4) return;
    qmCurrentVal += key;
  }
  const display = document.getElementById('qm-display');
  if (display) display.textContent = qmCurrentVal || '0';
}

function confirmarQtyNumpad() {
  const val = parseInt(qmCurrentVal) || 0;
  if (val > 0) confirmarQtyPicker(val);
  else fecharQtyPicker();
}

function fecharQtyPicker() {
  qtyPickerId = null;
  document.getElementById('qty-overlay').classList.remove('open');
  document.getElementById('qty-modal').classList.remove('open');
}

function confirmarQtyPicker(qty) {
  if (!qtyPickerId) return;
  const id = qtyPickerId;
  fecharQtyPicker();
  setQtyCarrinho(id, qty);
}

function confirmarQtyCustom() {
  const v = parseInt(document.getElementById('qty-custom-inp').value);
  if (v > 0) confirmarQtyPicker(v);
}

/* ── Fundo de Caixa ───────────────────────── */
let fundoCaixaAtual = 0;

async function carregarFundo() {
  try {
    const data = await apiFetch('/admin/fundo');
    fundoCaixaAtual = Number(data.fundo) || 0;
  } catch {
    // fallback para localStorage se API falhar
    fundoCaixaAtual = parseFloat(localStorage.getItem('fundo_caixa') || '0') || 0;
  }
  const inp = document.getElementById('fundo-inp');
  if (inp && !inp.matches(':focus')) inp.value = fundoCaixaAtual > 0 ? fmtMoeda(fundoCaixaAtual) : '';
  atualizarFundoResultado();
}

async function salvarFundo() {
  const val = lerMoeda('fundo-inp');
  const btn = document.querySelector('.fundo-save-btn');
  if (btn) { btn.textContent = '…'; btn.disabled = true; }
  try {
    await apiFetch('/admin/fundo', { method: 'POST', body: JSON.stringify({ fundo: val }) });
    fundoCaixaAtual = val;
    localStorage.setItem('fundo_caixa', val); // mantém backup local
    atualizarFundoResultado();
    showToast('✓ Fundo salvo!', 'green-toast');
  } catch (e) {
    showToast('Erro ao salvar fundo: ' + e.message, 'error-toast');
  } finally {
    if (btn) { btn.textContent = '✓ Salvar'; btn.disabled = false; }
  }
}

function atualizarFundoResultado() {
  const el = document.getElementById('fundo-resultado');
  if (!el) return;
  if (fundoCaixaAtual === 0 && dinheiroVendas === 0) { el.innerHTML = ''; return; }
  const esperado = fundoCaixaAtual + dinheiroVendas;
  el.innerHTML = `
    <div class="fc-row"><span>Fundo inicial</span><span>${fmt(fundoCaixaAtual)}</span></div>
    <div class="fc-row"><span>Vendas em dinheiro</span><span>${fmt(dinheiroVendas)}</span></div>
    <div class="fc-row fc-total"><span>Esperado no caixa</span><span>${fmt(esperado)}</span></div>`;
}

/* ── WhatsApp ─────────────────────────────── */
async function compartilharWhatsApp() {
  try {
    const resumo = await apiFetch('/vendas/resumo');
    const agora  = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    const margem = resumo.total_arrecadado > 0 ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) : 0;
    const pag    = resumo.pagamentos || {};

    const linhasPag = [
      pag.dinheiro > 0 ? `💵 Dinheiro: ${fmt(pag.dinheiro)}` : '',
      pag.pix      > 0 ? `📱 Pix: ${fmt(pag.pix)}`           : '',
      pag.cartao   > 0 ? `💳 Cartão: ${fmt(pag.cartao)}`      : '',
    ].filter(Boolean).join('\n');
    const fundoWpp = parseFloat(localStorage.getItem('fundo_caixa') || '0') || 0;
    const linhaFundo = fundoWpp > 0
      ? `\n🗃 Fundo: ${fmt(fundoWpp)} → Esperado no caixa: ${fmt(fundoWpp + (pag.dinheiro || 0))}` : '';

    const texto = [
      `🤠 *${eventoAtual?.nome || 'Caixa UNIFSP'}*`,
      ``,
      `📊 *${resumo.total_vendas}* vendas`,
      `💰 *${fmt(resumo.total_arrecadado)}* arrecadado`,
      `📈 *${fmt(resumo.total_lucro)}* de lucro *(${margem}%)*`,
      linhasPag ? `\n${linhasPag}` : '',
      linhaFundo,
      ``,
      `_${agora}_`,
    ].filter(s => s !== undefined).join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

/* ── CSV ──────────────────────────────────── */
function csvNum(v) { return Number(v).toFixed(2).replace('.', ','); }
function csvStr(v) { return `"${String(v || '').replace(/"/g, '""')}"`; }
function csvRow(...cells) { return cells.join(';'); }

async function exportarCSV() {
  try {
    const [vendas, itens, resumo] = await Promise.all([
      historicoVendas || apiFetch('/vendas'),
      relatorioItens  || apiFetch('/vendas/relatorio'),
      apiFetch('/vendas/resumo')
    ]);
    const agora      = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const nomeEvento = eventoAtual?.nome || 'Caixa UNIFSP';
    const pag        = resumo.pagamentos || {};
    const totalCusto = itens.reduce((s, i) => s + Number(i.custo_total), 0);
    const margem     = resumo.total_arrecadado > 0
      ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) : 0;
    const fundo       = parseFloat(localStorage.getItem('fundo_caixa') || '0') || 0;

    const linhas = [];

    // ── Cabeçalho ──
    linhas.push(csvRow(csvStr(nomeEvento), '', '', '', '', '', ''));
    linhas.push(csvRow(csvStr(`Relatório de vendas · gerado em ${agora}`), '', '', '', '', '', ''));
    linhas.push('');

    // ── Resumo geral ──
    linhas.push(csvRow('RESUMO', '', '', '', '', '', ''));
    linhas.push(csvRow('Vendas', 'Arrecadado (R$)', 'Custo total (R$)', 'Lucro (R$)', 'Margem', '', ''));
    linhas.push(csvRow(resumo.total_vendas, csvNum(resumo.total_arrecadado), csvNum(totalCusto), csvNum(resumo.total_lucro), `${margem}%`, '', ''));
    const nCustoCSV = Number(resumo.vendas_custo) || 0;
    if (nCustoCSV > 0) {
      linhas.push('');
      linhas.push(csvRow('SPLIT NORMAL / CUSTO', '', '', '', '', '', ''));
      linhas.push(csvRow('Tipo', 'Qtd vendas', 'Arrecadado (R$)', '', '', '', ''));
      linhas.push(csvRow('Preço normal', Number(resumo.vendas_normal), csvNum(resumo.arrecadado_normal), '', '', '', ''));
      linhas.push(csvRow('Preço de custo', nCustoCSV, csvNum(resumo.arrecadado_custo), '', '', '', ''));
    }
    linhas.push('');

    // ── Pagamentos ──
    linhas.push(csvRow('FORMAS DE PAGAMENTO', '', '', '', '', '', ''));
    linhas.push(csvRow('Dinheiro (R$)', 'Pix (R$)', 'Cartão (R$)', '', '', '', ''));
    linhas.push(csvRow(csvNum(pag.dinheiro || 0), csvNum(pag.pix || 0), csvNum(pag.cartao || 0), '', '', '', ''));
    if (fundo > 0) {
      linhas.push('');
      linhas.push(csvRow('FUNDO DE CAIXA', '', '', '', '', '', ''));
      linhas.push(csvRow('Fundo inicial (R$)', 'Dinheiro em vendas (R$)', 'Esperado no caixa (R$)', '', '', '', ''));
      linhas.push(csvRow(csvNum(fundo), csvNum(pag.dinheiro || 0), csvNum(fundo + (pag.dinheiro || 0)), '', '', '', ''));
    }
    linhas.push('');

    // ── Por produto ──
    linhas.push(csvRow('DESEMPENHO POR PRODUTO', '', '', '', '', '', '', '', ''));
    linhas.push(csvRow('Produto', 'Qtd total', 'Qtd normal', 'Qtd ao custo', 'Receita normal (R$)', 'Receita custo (R$)', 'Receita total (R$)', 'Custo total (R$)', 'Lucro (R$)'));
    const itensFiltrados = itens.filter(i => Number(i.qtd_vendida) > 0);
    itensFiltrados.forEach(item => {
      const qtd     = Number(item.qtd_vendida);
      const receita = Number(item.receita);
      const custo_t = Number(item.custo_total);
      const lucro   = Number(item.lucro);
      linhas.push(csvRow(
        csvStr(item.nome), qtd,
        Number(item.qtd_normal || 0),
        Number(item.qtd_custo  || 0),
        csvNum(item.receita_normal || 0),
        csvNum(item.receita_custo  || 0),
        csvNum(receita), csvNum(custo_t), csvNum(lucro)
      ));
    });
    const totalQtd = itensFiltrados.reduce((s, i) => s + Number(i.qtd_vendida), 0);
    linhas.push(csvRow('TOTAL', totalQtd, '', '', '', csvNum(resumo.total_arrecadado), csvNum(totalCusto), csvNum(resumo.total_lucro)));
    linhas.push('');

    // ── Histórico de vendas ──
    linhas.push(csvRow('HISTÓRICO DE VENDAS', '', '', '', '', '', ''));
    linhas.push(csvRow('#', 'Data', 'Hora', 'Descrição', 'Itens', 'Total (R$)', 'Pagamento'));
    vendas.forEach((v, i) => {
      const d    = parseDataUTC(v.criado_em);
      const data = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      linhas.push(csvRow(vendas.length - i, data, hora, csvStr(v.descricao), v.itens_count, csvNum(v.total), v.forma_pagamento || 'dinheiro'));
    });

    const csv  = '﻿' + linhas.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }).replace(/\//g, '-');
    const slug = nomeEvento.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 30);
    a.href = url; a.download = `${slug}-${hoje}.csv`; a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exportado!', 'green-toast');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

/* ── PDF ──────────────────────────────────── */
async function gerarPDF() {
  const btn = document.getElementById('btn-gerar-pdf');
  if (btn) { btn.textContent = '⏳ Gerando...'; btn.disabled = true; }
  try {
    const [itens, resumo] = await Promise.all([apiFetch('/vendas/relatorio'), apiFetch('/vendas/resumo')]);
    const agora      = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    const nomeEvento = eventoAtual?.nome || 'Caixa UNIFSP';
    const totalCusto = itens.reduce((s, i) => s + Number(i.custo_total), 0);
    const margem = resumo.total_arrecadado > 0 ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) : 0;
    const pag = resumo.pagamentos || {};

    const nCustoPDF = Number(resumo.vendas_custo) || 0;
    const custoSplitHtml = nCustoPDF > 0 ? `
<h2 style="margin-bottom:8px">Vendas ao preço de custo</h2>
<div class="pay-summary" style="grid-template-columns:1fr 1fr;margin-bottom:16px">
  <div class="sb"><div class="sl">Vendas ao preço normal</div><div class="sv">${Number(resumo.vendas_normal)} · ${fmt(Number(resumo.arrecadado_normal))}</div></div>
  <div class="sb" style="border:1px solid #FECACA"><div class="sl" style="color:#DC2626">Vendas ao preço de custo</div><div class="sv" style="color:#DC2626">${nCustoPDF} · ${fmt(Number(resumo.arrecadado_custo))}</div></div>
</div>` : '';

    const fundo = fundoCaixaAtual || 0;
    const esperadoCaixa = fundo + (pag.dinheiro || 0);
    const fundoHtml = fundo > 0 ? `
<p class="section-title" style="margin-top:16px">Fundo de caixa</p>
<div class="pay-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:20px">
  <div class="sb"><div class="sl">Fundo inicial</div><div class="sv">${fmt(fundo)}</div></div>
  <div class="sb"><div class="sl">Vendas em dinheiro</div><div class="sv">${fmt(pag.dinheiro || 0)}</div></div>
  <div class="sb highlight"><div class="sl">Esperado no caixa</div><div class="sv green">${fmt(esperadoCaixa)}</div></div>
</div>` : '';

    // Rank por qtd vendida
    const itensFiltrados = itens.filter(i => Number(i.qtd_vendida) > 0)
      .sort((a, b) => Number(b.qtd_vendida) - Number(a.qtd_vendida));
    const rankMap = {};
    itensFiltrados.slice(0, 3).forEach((item, i) => { rankMap[item.nome] = i + 1; });

    // Barra proporcional de pagamentos
    const totalPag    = (pag.dinheiro || 0) + (pag.pix || 0) + (pag.cartao || 0);
    const pctDinheiro = totalPag > 0 ? Math.round(((pag.dinheiro || 0) / totalPag) * 100) : 0;
    const pctPix      = totalPag > 0 ? Math.round(((pag.pix      || 0) / totalPag) * 100) : 0;
    const pctCartao   = totalPag > 0 ? 100 - pctDinheiro - pctPix : 0;

    const linhas = itensFiltrados.map(item => {
      const qtd        = Number(item.qtd_vendida);
      const qtdC       = Number(item.qtd_custo  || 0);
      const receita    = Number(item.receita);
      const custoTotal = Number(item.custo_total);
      const lucro      = Number(item.lucro);
      const custoUnit  = qtd > 0 ? custoTotal / qtd : 0;
      const rankNum    = rankMap[item.nome];
      const rankHtml   = rankNum === 1 ? `<span class="rank rank-1">🔥 #1</span>`
                       : rankNum === 2 ? `<span class="rank rank-2">#2</span>`
                       : rankNum === 3 ? `<span class="rank rank-3">#3</span>` : '';
      const qtdLabel   = qtdC > 0 ? `${qtd} <span style="color:#DC2626;font-size:10px">(${qtdC} custo)</span>` : qtd;
      return `<tr>
        <td>${rankHtml}${item.nome}</td>
        <td class="num">${qtdLabel}</td>
        <td class="num">${fmt(custoUnit)}</td>
        <td class="num">${fmt(receita)}</td>
        <td class="num">${fmt(custoTotal)}</td>
        <td class="num ${lucro >= 0 ? 'green' : 'red'}">${fmt(lucro)}</td>
      </tr>`;
    }).join('');

    const totalQtd = itens.reduce((s, i) => s + Number(i.qtd_vendida), 0);

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Relatório – ${nomeEvento}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;font-size:14px}
  .page-header{background:linear-gradient(135deg,#78350F 0%,#D97706 100%);color:#FEF3C7;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
  .page-title{font-size:22px;font-weight:900;letter-spacing:-.5px}
  .page-sub{font-size:12px;opacity:.8;margin-top:2px}
  .page-date{font-size:11px;opacity:.75;text-align:right}
  .body-wrap{padding:0 24px 24px}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .pay-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px}
  .sb{background:#f5f5f5;border-radius:8px;padding:12px 14px}
  .sb.highlight{background:#FEF3C7;border:1.5px solid #D97706}
  .sl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:4px;font-weight:700}
  .sv{font-size:19px;font-weight:800}
  .sv.green{color:#059669}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:8px}
  .pay-bar-wrap{display:flex;border-radius:6px;overflow:hidden;height:18px;margin-bottom:6px}
  .pay-bar-seg{display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;white-space:nowrap}
  .pay-bar-legend{display:flex;gap:16px;font-size:10px;color:#666;margin-bottom:20px}
  .pay-bar-legend span{display:flex;align-items:center;gap:4px}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
  table{width:100%;border-collapse:collapse}
  thead th{text-align:left;padding:9px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#fff;background:#78350F;white-space:nowrap}
  thead th.num{text-align:right}
  td{padding:8px 10px;border-bottom:1px solid #eee;font-size:13px;vertical-align:middle}
  tr:nth-child(even) td{background:#fafafa}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .green{color:#059669;font-weight:700}
  .red{color:#dc2626;font-weight:700}
  tfoot td{background:#FEF3C7;border-top:2px solid #D97706;font-weight:700;padding:9px 10px}
  .rank{display:inline-block;font-size:9px;font-weight:800;padding:1px 5px;border-radius:3px;margin-right:5px;vertical-align:middle}
  .rank-1{background:#D97706;color:#fff}
  .rank-2{background:#92400E;color:#FEF3C7}
  .rank-3{background:#B45309;color:#FEF3C7}
  .footer{margin-top:20px;color:#bbb;font-size:11px;text-align:center;border-top:1px solid #eee;padding-top:10px}
  @media print{body{}}
</style>
</head>
<body>
<div class="page-header">
  <div>
    <div class="page-title">${nomeEvento}</div>
    <div class="page-sub">Relatório de vendas</div>
  </div>
  <div class="page-date">Gerado em ${agora}</div>
</div>
<div class="body-wrap">
<div class="summary">
  <div class="sb"><div class="sl">Vendas</div><div class="sv">${resumo.total_vendas}</div></div>
  <div class="sb"><div class="sl">Arrecadado</div><div class="sv">${fmt(resumo.total_arrecadado)}</div></div>
  <div class="sb"><div class="sl">Custo total</div><div class="sv">${fmt(totalCusto)}</div></div>
  <div class="sb highlight"><div class="sl">Lucro (${margem}%)</div><div class="sv green">${fmt(resumo.total_lucro)}</div></div>
</div>
<p class="section-title">Formas de pagamento</p>
<div class="pay-grid">
  <div class="sb"><div class="sl">💵 Dinheiro</div><div class="sv">${fmt(pag.dinheiro || 0)}</div></div>
  <div class="sb"><div class="sl">🟣 Pix</div><div class="sv">${fmt(pag.pix || 0)}</div></div>
  <div class="sb"><div class="sl">💳 Cartão</div><div class="sv">${fmt(pag.cartao || 0)}</div></div>
</div>
<div class="pay-bar-wrap">
  ${pctDinheiro > 0 ? `<div class="pay-bar-seg" style="width:${pctDinheiro}%;background:#059669">${pctDinheiro >= 8 ? pctDinheiro + '%' : ''}</div>` : ''}
  ${pctPix      > 0 ? `<div class="pay-bar-seg" style="width:${pctPix}%;background:#6366F1">${pctPix >= 8 ? pctPix + '%' : ''}</div>` : ''}
  ${pctCartao   > 0 ? `<div class="pay-bar-seg" style="width:${pctCartao}%;background:#D97706">${pctCartao >= 8 ? pctCartao + '%' : ''}</div>` : ''}
</div>
<div class="pay-bar-legend">
  <span><span class="dot" style="background:#059669"></span>Dinheiro ${pctDinheiro}%</span>
  <span><span class="dot" style="background:#6366F1"></span>Pix ${pctPix}%</span>
  <span><span class="dot" style="background:#D97706"></span>Cartão ${pctCartao}%</span>
</div>
${fundoHtml}
${custoSplitHtml}
<p class="section-title">Por produto</p>
<table>
  <thead>
    <tr>
      <th>Produto</th>
      <th class="num">Qtd vendida</th>
      <th class="num">Custo/un.</th>
      <th class="num">Receita</th>
      <th class="num">Custo total</th>
      <th class="num">Lucro</th>
    </tr>
  </thead>
  <tbody>${linhas || '<tr><td colspan="6" style="text-align:center;color:#999;padding:20px">Nenhuma venda registrada</td></tr>'}</tbody>
  <tfoot><tr><td>Total</td><td class="num">${totalQtd}</td><td></td><td class="num">${fmt(resumo.total_arrecadado)}</td><td class="num">${fmt(totalCusto)}</td><td class="num green">${fmt(resumo.total_lucro)}</td></tr></tfoot>
</table>
<p class="footer">${nomeEvento} · ${agora}</p>
</div>
</body>
</html>`;

    const overlay = document.getElementById('pdf-overlay');
    const frame   = document.getElementById('pdf-frame');
    if (overlay && frame) {
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      frame.src  = url;
      overlay.classList.add('open');
      frame._blobUrl = url;
    }
  } catch (e) { showToast('Erro ao gerar PDF: ' + e.message, 'error-toast'); }
  finally { if (btn) { btn.textContent = '📄 PDF'; btn.disabled = false; } }
}

function fecharPdfOverlay() {
  const overlay = document.getElementById('pdf-overlay');
  const frame   = document.getElementById('pdf-frame');
  if (overlay) overlay.classList.remove('open');
  if (frame) {
    if (frame._blobUrl) { URL.revokeObjectURL(frame._blobUrl); frame._blobUrl = null; }
    frame.src = '';
  }
}

function imprimirPdf() {
  const frame = document.getElementById('pdf-frame');
  if (frame && frame.contentWindow) {
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }
}

/* ── WebSocket ────────────────────────────── */
function conectarWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url   = `${proto}://${location.host}`;
  try {
    wsConn = new WebSocket(url);
  } catch (e) { return; }

  wsConn.addEventListener('open', () => {
    wsConectado = true;
    document.getElementById('status-conexao').textContent = '● Online';
    document.getElementById('status-conexao').className = 'status-ok';
  });

  wsConn.addEventListener('message', evt => {
    try { handleWsMsg(JSON.parse(evt.data)); } catch (_) {}
  });

  wsConn.addEventListener('close', () => {
    wsConectado = false;
    wsConn = null;
    setTimeout(conectarWS, 4000);
  });

  wsConn.addEventListener('error', () => {
    wsConectado = false;
  });
}

function handleWsMsg(data) {
  if (!data || !data.type) return;
  const activeTab = document.querySelector('.section.active')?.id;

  switch (data.type) {
    case 'produto_atualizado': {
      const idx = produtos.findIndex(p => p.id === data.produto.id);
      if (idx >= 0) produtos[idx] = data.produto;
      else produtos.push(data.produto);
      if (activeTab === 'tab-venda')   renderVenda();
      if (activeTab === 'tab-estoque') renderEstoque();
      break;
    }
    case 'produto_novo': {
      if (!produtos.find(p => p.id === data.produto.id)) produtos.push(data.produto);
      if (activeTab === 'tab-venda')   renderVenda();
      if (activeTab === 'tab-estoque') renderEstoque();
      break;
    }
    case 'produto_deletado': {
      produtos = produtos.filter(p => p.id !== data.id);
      if (activeTab === 'tab-venda')   renderVenda();
      if (activeTab === 'tab-estoque') renderEstoque();
      break;
    }
    case 'venda_nova':
    case 'venda_deletada': {
      carregarResumo();
      if (activeTab === 'tab-historico') carregarHistorico();
      if (activeTab === 'tab-relatorio') carregarRelatorio();
      if (data.type === 'venda_nova') carregarProdutos();
      break;
    }
    case 'reposicao_nova': {
      if (activeTab === 'tab-estoque') carregarReposicoes();
      break;
    }
    case 'historico_zerado': {
      carregarProdutos();
      carregarResumo();
      if (activeTab === 'tab-historico') carregarHistorico();
      if (activeTab === 'tab-relatorio') carregarRelatorio();
      if (activeTab === 'tab-estoque')   carregarReposicoes();
      break;
    }
    case 'sync_railway_concluido': {
      carregarProdutos();
      showToast('🔄 Estoque sincronizado com Railway', '');
      break;
    }
    case 'evento_renomeado': {
      if (msg.nome) atualizarNomeEvento(msg.nome);
      break;
    }
  }
}

/* ── Exportar Cardápio PDF ───────────────── */
function exportarCardapioPDF() {
  const btn = document.getElementById('btn-exportar-cardapio');
  if (btn) { btn.textContent = '⏳ Gerando...'; btn.disabled = true; }

  const agora = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
  const eventoNome = eventoAtual?.nome || 'Caixa UNIFSP';

  const cats = {};
  [...produtos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(p => {
    const cat = (p.categoria || '').trim() || 'Outros';
    if (!cats[cat]) cats[cat] = [];
    cats[cat].push(p);
  });
  const catOrder = ['Bebidas', 'Comidas', 'Outros'];
  const catKeys = [...new Set([...catOrder, ...Object.keys(cats)])].filter(k => cats[k]);

  const ocultarEsgotadosPreview = document.getElementById('pdf-ocultar-esgotados')?.checked ?? false;
  const totalItens = Object.values(cats).reduce((s, arr) => {
    return s + (ocultarEsgotadosPreview ? arr.filter(p => p.estoque > 0).length : arr.length);
  }, 0);
  // Paisagem A4: escala colunas e fontes para caber tudo numa página
  const numCols = totalItens <= 8  ? 4
                : totalItens <= 16 ? 5
                : totalItens <= 24 ? 6
                : totalItens <= 35 ? 7
                :                    8;
  const nameSz  = numCols <= 4 ? '14px' : numCols <= 5 ? '13px' : numCols <= 6 ? '12px' : '11px';
  const precoSz = numCols <= 4 ? '24px' : numCols <= 5 ? '21px' : numCols <= 6 ? '18px' : '16px';
  const padCard = numCols <= 5 ? '10px 12px' : '7px 10px';
  const buildRow = p => {
    const isDose   = !!(p.dose_ml && p.garrafa_ml);
    const unidade  = isDose ? 'doses' : 'un.';
    const esgotado = p.estoque === 0;
    const comboTxt = (p.combo_qtd && p.combo_preco)
      ? `<div class="combo">${p.combo_qtd} ${unidade} por ${fmt(Number(p.combo_preco) * p.combo_qtd)}</div>` : '';
    const doseTxt  = isDose
      ? `<div class="dose-tag">${p.dose_ml}ml · ${fmt(p.preco)}/dose</div>` : '';
    return `<div class="item${esgotado ? ' esgotado' : ''}">
      ${esgotado ? '<div class="esg-overlay"><span>Esgotado</span></div>' : ''}
      <div class="item-nome">${p.nome}</div>
      <div class="item-preco">${fmt(p.preco)}</div>
      ${doseTxt}${comboTxt}
    </div>`;
  };

  const catHtml = catKeys.map(cat => {
    const allItems = cats[cat];
    const available = allItems.filter(p => p.estoque > 0);
    const esgotados = allItems.filter(p => p.estoque === 0);
    const itensParaExibir = ocultarEsgotadosPreview ? available : [...available, ...esgotados];
    if (itensParaExibir.length === 0) return ''; // pula categoria vazia
    const rows = itensParaExibir.map(buildRow).join('');
    return `<div class="cat-block">
      <div class="cat-header"><span class="cat-title">${cat}</span><span class="cat-line"></span></div>
      <div class="grid">${rows}</div>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Cardápio – ${eventoNome}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  @page{size:A4 landscape;margin:8mm 10mm}
  html,body{width:100%;height:100%}
  body{
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    color:#1C0A00;background:#fff;
    display:flex;flex-direction:column;
  }

  /* Cabeçalho compacto */
  .page-header{
    background:linear-gradient(135deg,#78350F 0%,#D97706 100%);
    color:#FEF3C7;
    padding:9px 18px 8px;
    border-radius:8px;
    margin-bottom:10px;
    display:flex;align-items:center;justify-content:space-between;
    flex-shrink:0;
  }
  .page-title{font-size:22px;font-weight:900;letter-spacing:-.5px;line-height:1}
  .page-sub{font-size:11px;opacity:.8;margin-top:2px}
  .page-date{font-size:9px;opacity:.7;text-align:right}

  /* Área de conteúdo cresce para preencher a página */
  .content{flex:1;display:flex;flex-direction:column;gap:10px;overflow:hidden}

  /* Categoria */
  .cat-block{display:flex;flex-direction:column;gap:6px}
  .cat-header{display:flex;align-items:center;gap:8px}
  .cat-title{
    font-size:9px;font-weight:900;
    text-transform:uppercase;letter-spacing:.15em;
    color:#92400E;background:#FEF3C7;
    border-left:3px solid #D97706;
    padding:3px 10px 3px 7px;
    border-radius:0 4px 4px 0;
    white-space:nowrap;
    flex-shrink:0;
  }
  .cat-line{flex:1;height:1px;background:#F3E0B0}

  /* Grid de produtos */
  .grid{display:grid;grid-template-columns:repeat(${numCols},1fr);gap:5px}

  /* Card de produto */
  .item{
    border:1.5px solid #E8D5A0;
    border-radius:7px;
    padding:${padCard};
    background:#FFFDF7;
    position:relative;overflow:hidden;
    box-shadow:0 1px 4px rgba(0,0,0,.08);
  }
  .item.esgotado{background:#F5F5F5;border-color:#E0E0E0}

  .item-nome{
    font-size:${nameSz};font-weight:800;
    line-height:1.2;margin-bottom:4px;color:#1C0A00;
  }
  .item-preco{
    font-size:${precoSz};font-weight:900;
    color:#D97706;letter-spacing:-.3px;line-height:1;
  }
  .combo{
    display:inline-block;font-size:9px;font-weight:700;
    color:#065F46;background:#D1FAE5;
    border:1px solid #6EE7B7;border-radius:3px;
    padding:1px 5px;margin-top:4px;
  }
  .dose-tag{
    display:inline-block;font-size:9px;font-weight:700;
    color:#6B7280;background:#F3F4F6;
    border:1px solid #D1D5DB;border-radius:3px;
    padding:1px 5px;margin-top:4px;margin-right:3px;
  }

  /* Overlay esgotado */
  .esg-overlay{
    position:absolute;inset:0;
    background:rgba(255,255,255,.78);
    display:flex;align-items:center;justify-content:center;
    border-radius:5px;
  }
  .esg-overlay span{
    font-size:8px;font-weight:800;
    text-transform:uppercase;letter-spacing:.1em;
    color:#DC2626;border:1.5px solid #DC2626;
    border-radius:3px;padding:2px 7px;
  }

  /* Rodapé */
  .page-footer{
    margin-top:6px;text-align:center;
    font-size:8px;color:#B08050;
    border-top:1px solid #E8D5A0;padding-top:5px;
    flex-shrink:0;
  }

  @media print{
    html,body{height:100%}
    body{display:flex;flex-direction:column}
    .content{flex:1}
  }
</style>
</head>
<body>
<div class="page-header">
  <div>
    <div class="page-title">${eventoNome}</div>
    <div class="page-sub">Cardápio</div>
  </div>
  <div class="page-date">Gerado em ${agora}</div>
</div>
<div class="content">${catHtml}</div>
<div class="page-footer">${eventoNome} · ${agora} · preços sujeitos a alteração</div>
</body>
</html>`;

  const overlay = document.getElementById('pdf-overlay');
  const frame   = document.getElementById('pdf-frame');
  if (overlay && frame) {
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    frame.src  = url;
    if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
    frame._blobUrl = url;
    overlay.classList.add('open');
    document.querySelector('.pdf-toolbar-title').textContent = 'Cardápio PDF';
  }
  if (btn) { btn.textContent = '📋 Cardápio PDF'; btn.disabled = false; }
}

/* ── QR Code Cardápio ────────────────────── */
async function abrirQrCardapio() {
  const overlay  = document.getElementById('qr-overlay');
  const wrap     = document.getElementById('qr-img-wrap');
  const urlEl    = document.getElementById('qr-url');
  const abrirBtn = document.getElementById('qr-abrir-link');
  if (!overlay) return;
  overlay.classList.add('open');
  wrap.innerHTML = '<div style="color:var(--muted);padding:2rem">Gerando QR…</div>';
  const cardapioUrl = `${location.protocol}//${location.host}/cardapio`;
  if (urlEl)    urlEl.textContent = cardapioUrl;
  if (abrirBtn) abrirBtn.href = cardapioUrl;
  try {
    const res   = await fetch('/api/publico/cardapio-qr');
    const svg   = await res.text();
    wrap.innerHTML = svg;
    const svgEl = wrap.querySelector('svg');
    if (svgEl) {
      svgEl.style.width   = '220px';
      svgEl.style.height  = '220px';
      svgEl.style.display = 'block';
      svgEl.style.margin  = '0 auto';
    }
  } catch (e) {
    wrap.innerHTML = `<div style="color:var(--red);font-size:13px">Erro ao gerar QR: ${e.message}</div>`;
  }
}
function fecharQr() {
  document.getElementById('qr-overlay')?.classList.remove('open');
}
function baixarQr() {
  const svg = document.querySelector('#qr-img-wrap svg');
  if (!svg) return;
  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cardapio-qr.svg';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('✅ QR Code salvo', 'cardapio-qr.svg');
}
async function copiarLinkCardapio() {
  const url = document.getElementById('qr-url')?.textContent?.trim();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast('📋 Link copiado!', url);
  } catch {
    showToast('⚠️ Não foi possível copiar', 'Copie o endereço manualmente');
  }
}

/* ── Init ─────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  aplicarTema();
  updateTabPill('venda', true);
  updateBnavPill('venda', true);
  setupFormEnter();
  const ok = await checkAuth();
  if (ok) { ativarWakeLock(); carregarTudo(); conectarWS(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' &&
      document.getElementById('tab-venda').classList.contains('active'))
    ativarWakeLock();
});

setInterval(async () => {
  if (wsConectado) return; // WS está ativo, não precisa de polling
  const a = document.querySelector('.section.active').id;
  if (a === 'tab-venda') { await carregarProdutos(); await carregarResumo(); }
}, 60000);

/* ── Administração ───────────────────────────── */
async function abrirAdmin() {
  document.getElementById('admin-overlay').classList.add('open');
  document.getElementById('admin-modal').classList.add('open');
  document.getElementById('admin-zerar-confirm').style.display = 'none';
  document.getElementById('btn-zerar').style.display = 'block';
  document.getElementById('admin-cnt-vendas').textContent = '…';
  document.getElementById('admin-cnt-repos').textContent = '…';
  // Preenche o campo com o nome atual
  const nomeInp = document.getElementById('admin-nome-inp');
  if (nomeInp) nomeInp.value = eventoAtual?.nome || '';
  // Limpa campos de senha
  ['admin-senha-atual', 'admin-senha-nova', 'admin-senha-conf'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.type = 'password'; }
  });
  try {
    const s = await apiFetch('/admin/status');
    document.getElementById('admin-cnt-vendas').textContent = s.vendas;
    document.getElementById('admin-cnt-repos').textContent = s.reposicoes;
    document.getElementById('admin-sync-section').style.display = s.syncDisponivel ? 'block' : 'none';
  } catch (e) {
    document.getElementById('admin-cnt-vendas').textContent = 'erro';
    document.getElementById('admin-cnt-repos').textContent = 'erro';
  }
}

async function salvarNomeEvento() {
  const inp = document.getElementById('admin-nome-inp');
  const btn = document.getElementById('btn-salvar-nome');
  const nome = inp?.value.trim();
  if (!nome) { showToast('⚠ Digite um nome para o evento', 'error-toast'); return; }
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await apiFetch('/admin/evento-nome', { method: 'POST', body: JSON.stringify({ nome }) });
    atualizarNomeEvento(r.nome);
    showToast('✓ Nome do evento atualizado!', 'green-toast');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error-toast');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar';
  }
}

async function alterarSenha() {
  const senhaAtual = document.getElementById('admin-senha-atual')?.value;
  const novaSenha  = document.getElementById('admin-senha-nova')?.value;
  const conf       = document.getElementById('admin-senha-conf')?.value;
  if (!senhaAtual || !novaSenha || !conf) { showToast('⚠ Preencha todos os campos', 'error-toast'); return; }
  if (novaSenha !== conf) { showToast('⚠ As senhas não coincidem', 'error-toast'); return; }
  if (novaSenha.length < 4) { showToast('⚠ Mínimo de 4 caracteres', 'error-toast'); return; }
  const btn = document.getElementById('btn-alterar-senha');
  btn.disabled = true; btn.textContent = '…';
  try {
    await apiFetch('/admin/senha', { method: 'POST', body: JSON.stringify({ senhaAtual, novaSenha }) });
    ['admin-senha-atual', 'admin-senha-nova', 'admin-senha-conf'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = ''; el.type = 'password'; }
    });
    showToast('✓ Senha alterada com sucesso!', 'green-toast');
  } catch (e) {
    showToast('Erro: ' + e.message, 'error-toast');
  } finally {
    btn.disabled = false; btn.textContent = '🔑 Alterar senha';
  }
}

async function sincronizarRailway() {
  const btn = document.getElementById('btn-sync');
  btn.disabled    = true;
  btn.textContent = '⏳';
  try {
    const r = await apiFetch('/admin/sync-railway', { method: 'POST' });
    // Registra horário do último sync
    const agora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('admin-sync-ultimo').textContent = `Último sync: ${agora} — ${r.atualizados} atualizados, ${r.inseridos} novos`;
    // Recarrega produtos na tela
    await carregarProdutos();
    showToast(`✅ Sync OK! ${r.total} produto${r.total !== 1 ? 's' : ''} sincronizado${r.total !== 1 ? 's' : ''}.`, 'green-toast');
  } catch (e) {
    showToast('❌ Sync falhou: ' + e.message, 'error-toast');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sync';
  }
}

function fecharAdmin() {
  document.getElementById('admin-overlay').classList.remove('open');
  document.getElementById('admin-modal').classList.remove('open');
}

function pedirConfirmacaoZerar() {
  document.getElementById('btn-zerar').style.display = 'none';
  document.getElementById('admin-zerar-confirm').style.display = 'block';
}

function cancelarZerar() {
  document.getElementById('admin-zerar-confirm').style.display = 'none';
  document.getElementById('btn-zerar').style.display = 'block';
}

async function confirmarZerar() {
  const btn = document.getElementById('btn-confirmar-zerar');
  btn.disabled = true;
  btn.textContent = 'Zerando…';
  try {
    const r = await apiFetch('/admin/zerar-historico', { method: 'DELETE' });
    fecharAdmin();
    await carregarProdutos();
    await carregarResumo();
    showToast(`✅ Pronto! ${r.vendas} venda${r.vendas !== 1 ? 's' : ''} e ${r.reposicoes} reposição apagadas.`, 'green-toast');
  } catch (e) {
    showToast('Erro ao zerar: ' + e.message, 'error-toast');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sim, zerar histórico';
  }
}
