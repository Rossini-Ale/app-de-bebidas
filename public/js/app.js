const API = '';
let produtos = [], carrinho = [], editingId = null, cartSheetOpen = false, qtyPickerId = null;
let metodoPagamento = 'dinheiro', ultimaVendaId = null, undoTimer = null;
let sortVenda = 'vendido', sortEstoque = 'az', sortRelatorio = 'vendido', sortHistorico = 'recente';
let histPagina = 1;
const HIST_POR_PAG = 20;
let vendidoMap = {}, relatorioItens = null, historicoVendas = null;
let dinheiroVendas = 0, wakeLock = null, reposicaoId = null;
let eventoAtual = null, operadorAtual = 'Caixa', venderAoCusto = false;
let categoriaFiltro = '';
let wsConn = null, wsConectado = false;

function fmt(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
function fmtShort(v) { return 'R$' + Math.round(v); }

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
    return true;
  } catch { mostrarLogin(); return false; }
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
  document.getElementById('evento-badge').textContent = nome;
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
    ocultarLogin();
    relatorioItens = null; historicoVendas = null;
    carregarTudo();
  } catch (e) { erro.textContent = 'Erro de conexão'; }
  finally { btn.textContent = 'Entrar'; btn.disabled = false; }
}

async function fazerLogout() {
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
  el.innerHTML = [{ label: 'Todos', val: '' }, ...cats.map(c => ({ label: c, val: c }))]
    .map(item => `<button class="sort-btn${categoriaFiltro === item.val ? ' active' : ''}" onclick="setCatFiltro('${item.val}')">${item.label}</button>`)
    .join('');
}

function setCatFiltro(cat) {
  categoriaFiltro = cat;
  renderVenda();
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
    l.innerHTML = '<div class="empty-state">Nenhum produto encontrado</div>';
    return;
  }

  l.innerHTML = '<div class="produto-grid">' + lista.map(p => {
    const noStock    = p.estoque === 0;
    const veryLow    = p.estoque > 0 && p.estoque <= 24;
    const lowStock   = p.estoque > 0 && p.estoque <= 50;
    const itemCart   = carrinho.find(c => c.id === p.id);
    const inCart     = !!itemCart;
    const badge      = inCart ? `<span class="pc-badge" onclick="event.stopPropagation();abrirQtyPicker(${p.id})">${itemCart.qty}</span>` : '';
    const stockLabel = noStock  ? 'Sem estoque' :
                       veryLow  ? `⚠ ${p.estoque} un.` :
                                  `${p.estoque} un.`;
    const classes    = ['produto-card', noStock ? 'no-stock' : '', inCart ? 'in-cart' : '',
                        veryLow ? 'very-low-stock' : lowStock ? 'low-stock' : ''].filter(Boolean).join(' ');
    const onclick    = noStock ? '' : `onclick="addCarrinho(${p.id})"`;
    const barPct     = noStock ? 0 : Math.round((p.estoque / maxEstoque) * 100);
    const barColor   = p.estoque <= 24 ? 'var(--red)' : p.estoque <= 50 ? 'var(--amber)' : 'var(--green)';
    return `<div class="${classes}" data-id="${p.id}" ${onclick}>
      ${badge}
      <div class="pc-nome">${p.nome}</div>
      <div class="pc-preco">${fmt(p.preco)}</div>
      <div class="pc-stock">${stockLabel}</div>
      <button class="pc-btn" ${noStock ? 'disabled' : ''}>+</button>
      <div class="pc-stock-bar-wrap"><div class="pc-stock-bar" style="width:${barPct}%;background:${barColor}"></div></div>
    </div>`;
  }).join('') + '</div>';
}

function renderEstoque() {
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
  l.innerHTML = sortedEstoque.map(p => {
    if (editingId === p.id) {
      return `<div class="stock-item editing">
        <div class="stock-edit-header">
          <span>Editando produto</span>
        </div>
        <div class="stock-edit-grid">
          <input class="input input-sm" id="edit-nome-${p.id}" value="${p.nome}" placeholder="Nome" type="text" style="grid-column:1/-1" />
          <input class="input input-sm" id="edit-preco-${p.id}" value="${fmtMoeda(p.preco)}" placeholder="Preço R$" type="text" inputmode="numeric" oninput="mascaraMoedaInline(this)" />
          <input class="input input-sm" id="edit-custo-${p.id}" value="${fmtMoeda(p.custo)}" placeholder="Custo R$" type="text" inputmode="numeric" oninput="mascaraMoedaInline(this)" />
          <input class="input input-sm" id="edit-cat-${p.id}" value="${p.categoria || ''}" placeholder="Categoria (opcional)" type="text" list="cat-list" style="grid-column:1/-1" />
        </div>
        <div class="stock-edit-actions">
          <button class="btn-save" onclick="salvarEdicao(${p.id})">✓ Salvar</button>
          <button class="btn-cancel-inline" onclick="cancelarEdicao()">Cancelar</button>
        </div>
      </div>`;
    }
    const margem = p.custo > 0 ? Math.round(((p.preco - p.custo) / p.preco) * 100) : null;
    const isRepondo = reposicaoId === p.id;
    const qtyColor = p.estoque === 0 ? 'color:var(--red)' : p.estoque <= 24 ? 'color:var(--red)' : p.estoque <= 50 ? 'color:var(--amber)' : '';
    const qtyLabel = p.estoque <= 24 && p.estoque > 0 ? `⚠ ${p.estoque}` : `${p.estoque}`;
    return `<div class="stock-item">
      <div class="stock-info">
        <div class="stock-name">${p.nome}</div>
        <div class="stock-sub">Venda ${fmt(p.preco)} · Custo ${fmt(p.custo)}</div>
        ${margem !== null ? `<div class="stock-margin">Margem: ${margem}%</div>` : ''}
        <div class="stock-actions">
          <button class="stock-act-btn edit" onclick="editarProduto(${p.id})">✏ Editar</button>
          <button class="stock-act-btn repor ${isRepondo ? 'active' : ''}" onclick="abrirReposicao(${p.id})">+ Repor</button>
          <button class="stock-act-btn del"  onclick="excluirProduto(${p.id}, this)">Excluir</button>
        </div>
        ${isRepondo ? `<div class="repor-row">
          <input id="repor-inp-${p.id}" class="input repor-inp" type="number" min="1" placeholder="Qtd a adicionar…"
            onkeydown="if(event.key==='Enter')confirmarReposicao(${p.id})" />
          <button class="btn-repor-ok" onclick="confirmarReposicao(${p.id})">✓ Adicionar</button>
        </div>` : ''}
      </div>
      <div class="stock-qty">
        <button class="qty-btn" onclick="ajustarEstoque(${p.id}, -1)">−</button>
        <span class="qty-num" style="${qtyColor}">${qtyLabel}</span>
        <button class="qty-btn" onclick="ajustarEstoque(${p.id}, +1)">+</button>
      </div>
    </div>`;
  }).join('');
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
  el.innerHTML = rows.map(r => `
    <div class="reposicao-item">
      <div class="rep-info">
        <span class="rep-nome">${r.produto_nome}</span>
        <span class="rep-hora">${fmtDataHora(r.criado_em)}</span>
      </div>
      <div class="rep-right">
        <span class="rep-qty">+${r.quantidade}</span>
        <span class="rep-op">${r.operador}</span>
      </div>
    </div>`).join('');
}

function abrirReposicao(id) {
  editingId = null;
  reposicaoId = reposicaoId === id ? null : id;
  renderEstoque();
  if (reposicaoId) setTimeout(() => document.getElementById(`repor-inp-${id}`)?.focus(), 50);
}

async function confirmarReposicao(id) {
  const delta = parseInt(document.getElementById(`repor-inp-${id}`)?.value || '0');
  if (!delta || delta <= 0) return;
  try {
    const updated = await apiFetch(`/produtos/${id}/estoque`, { method: 'PATCH', body: JSON.stringify({ delta, registrar: true }) });
    const i = produtos.findIndex(p => p.id === id);
    if (i >= 0) produtos[i] = updated;
    reposicaoId = null;
    renderEstoque(); renderVenda();
    carregarReposicoes();
    showToast(`+${delta} unidades adicionadas`, 'green-toast');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

function editarProduto(id) {
  reposicaoId = null;
  editingId = id;
  renderEstoque();
  document.getElementById(`edit-nome-${id}`)?.focus();
}

function cancelarEdicao() {
  editingId = null;
  renderEstoque();
}

async function salvarEdicao(id) {
  const nome     = document.getElementById(`edit-nome-${id}`).value.trim();
  const preco    = lerMoeda(`edit-preco-${id}`);
  const custo    = lerMoeda(`edit-custo-${id}`);
  const categoria = (document.getElementById(`edit-cat-${id}`)?.value || '').trim();
  if (!nome || isNaN(preco)) { showToast('⚠ Preencha nome e preço', 'error-toast'); return; }
  const p = produtos.find(x => x.id === id);
  try {
    const updated = await apiFetch(`/produtos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome, emoji: p.emoji, preco, custo, estoque: p.estoque, estoque_minimo: p.estoque_minimo, categoria })
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
  const nome     = document.getElementById('new-name').value.trim();
  const preco    = lerMoeda('new-price');
  const custo    = lerMoeda('new-cost');
  const estoque  = parseInt(document.getElementById('new-qty').value) || 0;
  const categoria = (document.getElementById('new-cat')?.value || '').trim();
  if (!nome) { showToast('⚠ Informe o nome do produto', 'error-toast'); return; }
  try {
    const novo = await apiFetch('/produtos', { method: 'POST', body: JSON.stringify({ nome, preco, custo, estoque, categoria }) });
    produtos.push(novo);
    ['new-name', 'new-cat', 'new-price', 'new-cost', 'new-qty'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('margin-hint').textContent = 'Margem: —';
    renderEstoque(); renderVenda();
    showToast('✓ ' + nome + ' adicionado!', 'green-toast');
    document.getElementById('new-name').focus(); // volta o foco pro nome
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

function atualizarCartBar() {
  const bar     = document.getElementById('cart-bar');
  const badge   = document.getElementById('cart-badge');
  const infoBtn = document.getElementById('cart-bar-info');
  const sheet   = document.getElementById('cart-sheet');
  const isVenda = document.getElementById('tab-venda').classList.contains('active');
  const totalItens = carrinho.reduce((s, c) => s + c.qty, 0);

  if (badge) {
    if (totalItens > 0) { badge.textContent = totalItens > 9 ? '9+' : totalItens; badge.classList.add('show'); }
    else badge.classList.remove('show');
  }

  if (!bar) return;
  if (!totalItens || !isVenda) {
    bar.classList.remove('visible');
    cartSheetOpen = false;
    sheet?.classList.remove('open');
    return;
  }

  // Abre o sheet automaticamente sempre que há itens
  if (!cartSheetOpen) {
    cartSheetOpen = true;
    renderCartSheet();
    sheet?.classList.add('open');
  }

  const total = carrinho.reduce((s, c) => {
    const p = produtos.find(x => x.id === c.id);
    return s + p.preco * c.qty;
  }, 0);

  if (infoBtn) {
    const arrow = cartSheetOpen ? '▾' : '▴';
    infoBtn.innerHTML = `<span style="font-size:11px;opacity:.8">${arrow}</span> ${totalItens} ${totalItens === 1 ? 'item' : 'itens'} · ${fmt(total)}`;
  }
  bar.classList.add('visible');
}

function renderCartSheet() {
  const el = document.getElementById('cart-sheet-items');
  if (!el) return;
  el.innerHTML = carrinho.map(c => {
    const p = produtos.find(x => x.id === c.id);
    return `<div class="cs-item">
      <span class="cs-name">${p.nome}</span>
      <div class="cs-controls">
        <button class="cs-ctrl" onclick="removeCarrinho(${c.id})">−</button>
        <span class="cs-qty" id="csq-${c.id}" onclick="editQtyInline(${c.id})" title="Toque para editar">${c.qty}</span>
        <button class="cs-ctrl" onclick="addCarrinho(${c.id})">+</button>
      </div>
      <span class="cs-price">${fmt(p.preco * c.qty)}</span>
    </div>`;
  }).join('');
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
  const sheet = document.getElementById('cart-sheet');
  if (cartSheetOpen) { renderCartSheet(); sheet?.classList.add('open'); }
  else               { sheet?.classList.remove('open'); }
  atualizarCartBar();
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
      cartSheetOpen = false;
      document.getElementById('cart-sheet')?.classList.remove('open');
    } else {
      renderCartSheet();
    }
  }
  renderVenda();
  atualizarCartBar();
}

/* ── Pagamento ────────────────────────────── */
function totalCarrinho() {
  return carrinho.reduce((s, c) => {
    const p = produtos.find(x => x.id === c.id);
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
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
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
  undoTimer = setTimeout(() => { bar.classList.remove('show'); ultimaVendaId = null; }, 8000);
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
    countUp(document.getElementById('m-vendas'), r.total_vendas,        v => String(Math.round(v)));
    countUp(document.getElementById('m-total'),  r.total_arrecadado,    fmtShort);
    countUp(document.getElementById('m-lucro'),  r.total_lucro,         fmtShort);
    countUp(document.getElementById('h-vendas'), r.total_vendas,        v => String(Math.round(v)));
    countUp(document.getElementById('h-total'),  r.total_arrecadado,    fmtShort);
    countUp(document.getElementById('h-ticket'), r.ticket_medio,        fmtShort);
  } catch {}
}

async function carregarRelatorio() {
  const l = document.getElementById('relatorio-lista');
  l.innerHTML = '<div class="loading">Carregando...</div>';
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
  el.innerHTML = data.map(op => `
    <div class="operador-card">
      <span class="op-nome">${op.operador || 'Caixa'}</span>
      <div class="op-stats">
        <span class="op-vendas">${op.total_vendas} venda${op.total_vendas !== 1 ? 's' : ''}</span>
        <span class="op-total">${fmt(op.total_arrecadado)}</span>
      </div>
    </div>`).join('');
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
  l.innerHTML = sorted.map(item => {
    const receita    = Number(item.receita);
    const lucro      = Number(item.lucro);
    const custoTotal = Number(item.custo_total);
    const qtdCusto   = Number(item.qtd_custo  || 0);
    const qtdNormal  = Number(item.qtd_normal || 0);
    const recNormal  = Number(item.receita_normal || 0);
    const recCusto   = Number(item.receita_custo  || 0);
    const pct        = Math.max(0, Math.min(100, Math.round((receita / maxReceita) * 100)));
    const isNeg      = lucro < 0;
    const badgeCusto = qtdCusto > 0 ? `<span class="badge-custo">${qtdCusto} ao custo</span>` : '';
    const receitaDetalhe = qtdCusto > 0
      ? `<div class="rb-split"><span>${fmt(recNormal)} normal</span><span class="red">${fmt(recCusto)} custo</span></div>`
      : '';
    return `<div class="relatorio-item">
      <div class="rel-header">
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
  el.innerHTML = horas.map(h => {
    const pct = Math.max(3, Math.round((porHora[h] / maxQtd) * 100));
    return `<div class="gh-row">
      <span class="gh-hora">${h}h</span>
      <div class="gh-bar-h-wrap"><div class="gh-bar-h" style="width:${pct}%"></div></div>
      <span class="gh-count">${porHora[h]}</span>
    </div>`;
  }).join('');
}

async function deletarVenda(id, btn) {
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Confirmar?';
    btn._timer = setTimeout(() => { btn.classList.remove('confirming'); btn.textContent = '🗑 Excluir'; }, 3000);
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
    btn.classList.remove('confirming'); btn.textContent = '🗑 Excluir'; btn.disabled = false;
  }
}

async function carregarHistorico() {
  const l = document.getElementById('historico-lista');
  l.innerHTML = '<div class="loading">Carregando...</div>';
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

  const busca = (document.getElementById('busca-historico')?.value || '').trim().toLowerCase();
  const filtrado = busca
    ? sorted.filter(venda =>
        (venda.descricao || '').toLowerCase().includes(busca) ||
        (venda.operador  || '').toLowerCase().includes(busca) ||
        (venda.forma_pagamento || '').toLowerCase().includes(busca))
    : sorted;

  if (!filtrado.length) {
    l.innerHTML = '<div class="empty-state">Nenhuma venda encontrada</div>';
    return;
  }

  const totalPags = Math.ceil(filtrado.length / HIST_POR_PAG);
  histPagina = Math.min(histPagina, totalPags);
  const inicio = (histPagina - 1) * HIST_POR_PAG;
  const pagina = filtrado.slice(inicio, inicio + HIST_POR_PAG);

  const labelPag = { dinheiro: '💵 Dinheiro', pix: 'Pix', cartao: '💳 Cartão' };
  const itensHtml = pagina.map(venda => {
    const num = v.length - v.findIndex(x => x.id === venda.id);
    return `<div class="historico-item" id="hist-${venda.id}">
      <span class="hist-num">#${num}</span>
      <div class="hist-info">
        <div class="hist-desc">${venda.descricao}</div>
        <div class="hist-hora">${fmtDataHora(venda.criado_em)}</div>
      </div>
      <div class="hist-right">
        <span class="hist-total">${fmt(venda.total)}</span>
        <span class="hist-pag">${labelPag[venda.forma_pagamento] || venda.forma_pagamento || 'Dinheiro'}</span>
        ${venda.operador ? `<span class="hist-operador">${venda.operador}</span>` : ''}
        <button class="hist-del" onclick="deletarVenda(${venda.id}, this)">🗑 Excluir</button>
      </div>
    </div>`;
  }).join('');

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
  const curQty = carrinho.find(c => c.id === id)?.qty || 0;
  document.getElementById('qm-nome').textContent    = p.nome;
  document.getElementById('qm-estoque').textContent = `${p.estoque} em estoque · R$${(p.preco).toFixed(2).replace('.',',')} cada`;
  document.getElementById('qty-custom-inp').value   = '';
  document.querySelectorAll('.qty-preset-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.qty) === curQty);
  });
  document.getElementById('qty-overlay').classList.add('open');
  document.getElementById('qty-modal').classList.add('open');
  setTimeout(() => document.getElementById('qty-custom-inp').focus(), 50);
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
function carregarFundo() {
  const val = parseFloat(localStorage.getItem('fundo_caixa') || '0') || 0;
  const inp = document.getElementById('fundo-inp');
  if (inp && !inp.matches(':focus')) inp.value = val > 0 ? fmtMoeda(val) : '';
  atualizarFundoResultado();
}

function salvarFundo() {
  const val = lerMoeda('fundo-inp');
  localStorage.setItem('fundo_caixa', val);
  atualizarFundoResultado();
  showToast('Fundo salvo!', 'green-toast');
}

function atualizarFundoResultado() {
  const el = document.getElementById('fundo-resultado');
  if (!el) return;
  const fundo = parseFloat(localStorage.getItem('fundo_caixa') || '0') || 0;
  if (fundo === 0 && dinheiroVendas === 0) { el.innerHTML = ''; return; }
  const esperado = fundo + dinheiroVendas;
  el.innerHTML = `
    <div class="fc-row"><span>Fundo inicial</span><span>${fmt(fundo)}</span></div>
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
      `🤠 *Caixa UNIFSP*`,
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

    const fundo = parseFloat(localStorage.getItem('fundo_caixa') || '0') || 0;
    const esperadoCaixa = fundo + (pag.dinheiro || 0);
    const fundoHtml = fundo > 0 ? `
<h2 style="margin-bottom:8px">Fundo de caixa</h2>
<div class="pay-summary" style="grid-template-columns:1fr 1fr 1fr;">
  <div class="sb"><div class="sl">Fundo inicial</div><div class="sv">${fmt(fundo)}</div></div>
  <div class="sb"><div class="sl">Vendas em dinheiro</div><div class="sv">${fmt(pag.dinheiro || 0)}</div></div>
  <div class="sb"><div class="sl">Esperado no caixa</div><div class="sv green">${fmt(esperadoCaixa)}</div></div>
</div>` : '';

    const linhas = itens.filter(i => Number(i.qtd_vendida) > 0).map(item => {
      const qtd        = Number(item.qtd_vendida);
      const qtdN       = Number(item.qtd_normal || 0);
      const qtdC       = Number(item.qtd_custo  || 0);
      const receita    = Number(item.receita);
      const custoTotal = Number(item.custo_total);
      const lucro      = Number(item.lucro);
      const precoUnit  = qtd > 0 ? receita / qtd : 0;
      const custoUnit  = qtd > 0 ? custoTotal / qtd : 0;
      const lucroUnit  = qtd > 0 ? lucro / qtd : 0;
      const qtdLabel   = qtdC > 0 ? `${qtd} <span style="color:#DC2626;font-size:10px">(${qtdC} custo)</span>` : qtd;
      return `<tr>
        <td>${item.nome}</td>
        <td class="num">${qtdLabel}</td>
        <td class="num">${fmt(precoUnit)}</td>
        <td class="num">${fmt(custoUnit)}</td>
        <td class="num ${lucroUnit >= 0 ? 'green' : 'red'}">${fmt(lucroUnit)}</td>
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
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a1a;padding:28px 32px;font-size:14px}
  h1{font-size:22px;font-weight:800;margin-bottom:3px}
  .sub{color:#666;font-size:12px;margin-bottom:24px}
  .summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
  .pay-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:28px}
  .sb{background:#f5f5f5;border-radius:8px;padding:12px 14px}
  .sl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:4px;font-weight:700}
  .sv{font-size:19px;font-weight:800}
  .sv.green{color:#059669}
  h2{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:10px}
  table{width:100%;border-collapse:collapse}
  thead tr{background:#f0f0f0}
  th{text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#666;border-bottom:2px solid #ddd;white-space:nowrap}
  th.group{text-align:center;background:#e8e8e8;border-bottom:1px solid #ccc;font-size:10px;letter-spacing:.04em}
  td{padding:8px 10px;border-bottom:1px solid #eee;font-size:12px}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .green{color:#059669;font-weight:700}
  .red{color:#dc2626;font-weight:700}
  tfoot tr{background:#f8f8f8;font-weight:700}
  tfoot td{border-top:2px solid #ccc;border-bottom:none;padding:8px 10px}
  .sep{border-left:2px solid #ddd}
  .footer{margin-top:28px;color:#aaa;font-size:11px;text-align:center}
  @media print{body{padding:0}}
</style>
</head>
<body>
<h1>${nomeEvento}</h1>
<p class="sub">Relatório de vendas · gerado em ${agora}</p>
<div class="summary">
  <div class="sb"><div class="sl">Vendas</div><div class="sv">${resumo.total_vendas}</div></div>
  <div class="sb"><div class="sl">Arrecadado</div><div class="sv">${fmt(resumo.total_arrecadado)}</div></div>
  <div class="sb"><div class="sl">Custo total</div><div class="sv">${fmt(totalCusto)}</div></div>
  <div class="sb"><div class="sl">Lucro (${margem}%)</div><div class="sv green">${fmt(resumo.total_lucro)}</div></div>
</div>
<h2 style="margin-bottom:8px">Formas de pagamento</h2>
<div class="pay-summary">
  <div class="sb"><div class="sl">💵 Dinheiro</div><div class="sv">${fmt(pag.dinheiro || 0)}</div></div>
  <div class="sb"><div class="sl">Pix</div><div class="sv">${fmt(pag.pix || 0)}</div></div>
  <div class="sb"><div class="sl">💳 Cartão</div><div class="sv">${fmt(pag.cartao || 0)}</div></div>
</div>
${fundoHtml}
${custoSplitHtml}
<h2>Por produto</h2>
<table>
  <thead>
    <tr>
      <th rowspan="2">Produto</th>
      <th rowspan="2" class="num">Qtd</th>
      <th colspan="3" class="group sep">Por unidade</th>
      <th colspan="3" class="group sep">Total</th>
    </tr>
    <tr>
      <th class="num sep">Preço</th><th class="num">Custo</th><th class="num">Lucro</th>
      <th class="num sep">Receita</th><th class="num">Custo</th><th class="num">Lucro</th>
    </tr>
  </thead>
  <tbody>${linhas || '<tr><td colspan="8" style="text-align:center;color:#999;padding:20px">Nenhuma venda registrada</td></tr>'}</tbody>
  <tfoot><tr><td>Total</td><td class="num">${totalQtd}</td><td class="sep" colspan="3"></td><td class="num sep">${fmt(resumo.total_arrecadado)}</td><td class="num">${fmt(totalCusto)}</td><td class="num green">${fmt(resumo.total_lucro)}</td></tr></tfoot>
</table>
<p class="footer">${nomeEvento} · ${agora}</p>
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
