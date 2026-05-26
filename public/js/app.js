const API = '';
let produtos = [], carrinho = [], editingId = null, cartSheetOpen = false, qtyPickerId = null;
let metodoPagamento = 'dinheiro', ultimaVendaId = null, undoTimer = null;

function fmt(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
function fmtShort(v) { return 'R$' + Math.round(v); }

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
  if (tab === 'estoque')   renderEstoque();
  if (tab === 'historico') carregarHistorico();
  if (tab === 'relatorio') carregarRelatorio();
  if (tab === 'venda')     { carregarProdutos(); carregarResumo(); }
  atualizarCartBar();
}

/* ── API ──────────────────────────────────── */
async function apiFetch(path, opts = {}) {
  const r = await fetch(API + '/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Erro');
  return d;
}

async function carregarTudo() {
  try {
    await Promise.all([carregarProdutos(), carregarResumo()]);
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
        if (ant && ant.estoque > 0 && p.estoque === 0)
          showToast(`⚠ ${p.nome} zerou!`, 'error-toast');
      });
    }
    renderVenda();
    renderEstoque();
  } catch (e) {
    document.getElementById('venda-lista').innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`;
  }
}

function renderVenda() {
  const l = document.getElementById('venda-lista');
  if (!produtos.length) {
    l.innerHTML = '<div class="empty-state">Nenhum produto cadastrado</div>';
    return;
  }
  // Produtos com estoque vêm primeiro; sem estoque ficam no final
  const sorted = [...produtos].sort((a, b) => (a.estoque === 0) - (b.estoque === 0));
  const maxEstoque = Math.max(...sorted.map(p => p.estoque), 1);

  l.innerHTML = '<div class="produto-grid">' + sorted.map(p => {
    const noStock    = p.estoque === 0;
    const veryLow    = p.estoque > 0 && p.estoque <= 2;
    const lowStock   = p.estoque > 0 && p.estoque <= 5;
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
    const barColor   = p.estoque <= 2 ? 'var(--red)' : p.estoque <= 5 ? 'var(--amber)' : 'var(--green)';
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
  l.innerHTML = produtos.map(p => {
    if (editingId === p.id) {
      return `<div class="stock-item editing">
        <div class="stock-edit-header">
          <span>Editando produto</span>
        </div>
        <div class="stock-edit-grid">
          <input class="input input-sm" id="edit-nome-${p.id}" value="${p.nome}" placeholder="Nome" type="text" style="grid-column:1/-1" />
          <input class="input input-sm" id="edit-preco-${p.id}" value="${p.preco}" placeholder="Preço R$" type="number" min="0" step="0.5" />
          <input class="input input-sm" id="edit-custo-${p.id}" value="${p.custo}" placeholder="Custo R$" type="number" min="0" step="0.5" />
        </div>
        <div class="stock-edit-actions">
          <button class="btn-save" onclick="salvarEdicao(${p.id})">✓ Salvar</button>
          <button class="btn-cancel-inline" onclick="cancelarEdicao()">Cancelar</button>
        </div>
      </div>`;
    }
    const margem = p.custo > 0 ? Math.round(((p.preco - p.custo) / p.preco) * 100) : null;
    return `<div class="stock-item">
      <div class="stock-info">
        <div class="stock-name">${p.nome}</div>
        <div class="stock-sub">Venda ${fmt(p.preco)} · Custo ${fmt(p.custo)}</div>
        ${margem !== null ? `<div class="stock-margin">Margem: ${margem}%</div>` : ''}
        <div class="stock-actions">
          <button class="stock-act-btn edit" onclick="editarProduto(${p.id})">✏ Editar</button>
          <button class="stock-act-btn del"  onclick="excluirProduto(${p.id}, this)">Excluir</button>
        </div>
      </div>
      <div class="stock-qty">
        <button class="qty-btn" onclick="ajustarEstoque(${p.id}, -1)">−</button>
        <span class="qty-num">${p.estoque}</span>
        <button class="qty-btn" onclick="ajustarEstoque(${p.id}, +1)">+</button>
      </div>
    </div>`;
  }).join('');
}

function editarProduto(id) {
  editingId = id;
  renderEstoque();
  document.getElementById(`edit-nome-${id}`)?.focus();
}

function cancelarEdicao() {
  editingId = null;
  renderEstoque();
}

async function salvarEdicao(id) {
  const nome  = document.getElementById(`edit-nome-${id}`).value.trim();
  const preco = parseFloat(document.getElementById(`edit-preco-${id}`).value);
  const custo = parseFloat(document.getElementById(`edit-custo-${id}`).value) || 0;
  if (!nome || isNaN(preco)) { showToast('⚠ Preencha nome e preço', 'error-toast'); return; }
  const p = produtos.find(x => x.id === id);
  try {
    const updated = await apiFetch(`/produtos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome, emoji: p.emoji, preco, custo, estoque: p.estoque, estoque_minimo: p.estoque_minimo })
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
  const preco = parseFloat(document.getElementById('new-price').value);
  const custo = parseFloat(document.getElementById('new-cost').value);
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
  const nome    = document.getElementById('new-name').value.trim();
  const preco   = parseFloat(document.getElementById('new-price').value);
  const custo   = parseFloat(document.getElementById('new-cost').value) || 0;
  const estoque = parseInt(document.getElementById('new-qty').value);
  if (!nome || isNaN(preco) || isNaN(estoque)) {
    showToast('⚠ Preencha nome, preço e quantidade', 'error-toast');
    return;
  }
  try {
    const novo = await apiFetch('/produtos', { method: 'POST', body: JSON.stringify({ nome, preco, custo, estoque }) });
    produtos.push(novo);
    ['new-name', 'new-price', 'new-cost', 'new-qty'].forEach(id => {
      document.getElementById(id).value = '';
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
  return carrinho.reduce((s, c) => { const p = produtos.find(x => x.id === c.id); return s + p.preco * c.qty; }, 0);
}

function abrirPagamento() {
  if (!carrinho.length) return;
  document.getElementById('pm-total').textContent = fmt(totalCarrinho());
  document.getElementById('pm-recebido').value = '';
  document.getElementById('pm-troco').textContent = '';
  selecionarPagamento('dinheiro');
  document.getElementById('pay-overlay').classList.add('open');
  document.getElementById('pay-modal').classList.add('open');
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
  document.getElementById('pm-recebido').value = valor;
  calcularTroco();
}

function calcularTroco() {
  const recebido = parseFloat(document.getElementById('pm-recebido').value) || 0;
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
    const venda = await apiFetch('/vendas', { method: 'POST', body: JSON.stringify({ itens, forma_pagamento: metodoPagamento }) });
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
    const [itens, resumo] = await Promise.all([apiFetch('/vendas/relatorio'), apiFetch('/vendas/resumo')]);
    countUp(document.getElementById('r-total'), resumo.total_arrecadado, fmtShort);
    countUp(document.getElementById('r-lucro'), resumo.total_lucro,      fmtShort);
    const margemNum = resumo.total_arrecadado > 0
      ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) : 0;
    if (resumo.total_arrecadado > 0)
      countUp(document.getElementById('r-margem'), margemNum, v => Math.round(v) + '%');
    else
      document.getElementById('r-margem').textContent = '—';
    const pag = resumo.pagamentos || {};
    countUp(document.getElementById('r-dinheiro'), pag.dinheiro || 0, fmtShort);
    countUp(document.getElementById('r-pix'),      pag.pix      || 0, fmtShort);
    countUp(document.getElementById('r-cartao'),   pag.cartao   || 0, fmtShort);

    if (!itens.length || itens.every(i => i.qtd_vendida == 0)) {
      l.innerHTML = '<div class="empty-state">📊<br/>Nenhuma venda registrada ainda</div>';
      return;
    }
    const maxReceita = Math.max(...itens.map(i => Number(i.receita)), 1);
    l.innerHTML = itens.map(item => {
      const receita   = Number(item.receita);
      const lucro     = Number(item.lucro);
      const custoTotal = Number(item.custo_total);
      const pct       = Math.max(0, Math.min(100, Math.round((receita / maxReceita) * 100)));
      const isNeg     = lucro < 0;
      return `<div class="relatorio-item">
        <div class="rel-header">
          <span class="rel-nome">${item.nome}</span>
          <span class="rel-qtd">${item.qtd_vendida} vendidos</span>
        </div>
        <div class="rel-grid">
          <div class="rel-box"><div class="rb-label">Receita</div><div class="rb-val">${fmt(receita)}</div></div>
          <div class="rel-box custo"><div class="rb-label">Custo</div><div class="rb-val">${fmt(custoTotal)}</div></div>
          <div class="rel-box lucro"><div class="rb-label">Lucro</div><div class="rb-val" style="${isNeg ? 'color:var(--red)' : ''}">${fmt(lucro)}</div></div>
        </div>
        <div class="rel-bar-wrap"><div class="rel-bar ${isNeg ? 'negativo' : ''}" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  } catch (e) { l.innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`; }
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
    document.getElementById(`hist-${id}`)?.remove();
    await carregarProdutos();
    await carregarResumo();
    showToast('Venda removida', 'green-toast');
    const lista = document.getElementById('historico-lista');
    if (!lista.querySelector('.historico-item'))
      lista.innerHTML = '<div class="empty-state">🧾<br/>Nenhuma venda ainda</div>';
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
    if (!v.length) { l.innerHTML = '<div class="empty-state">🧾<br/>Nenhuma venda ainda</div>'; return; }
    const labelPag = { dinheiro: '💵 Dinheiro', pix: 'Pix', cartao: '💳 Cartão' };
    l.innerHTML = v.map((venda, i) => `
      <div class="historico-item" id="hist-${venda.id}">
        <span class="hist-num">#${v.length - i}</span>
        <div class="hist-info">
          <div class="hist-desc">${venda.descricao}</div>
          <div class="hist-hora">${fmtDataHora(venda.criado_em)}</div>
        </div>
        <div class="hist-right">
          <span class="hist-total">${fmt(venda.total)}</span>
          <span class="hist-pag">${labelPag[venda.forma_pagamento] || venda.forma_pagamento || 'Dinheiro'}</span>
          <button class="hist-del" onclick="deletarVenda(${venda.id}, this)">🗑 Excluir</button>
        </div>
      </div>`).join('');
  } catch (e) { l.innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`; }
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

    const texto = [
      `🤠 *Caixa UNIFSP*`,
      ``,
      `📊 *${resumo.total_vendas}* vendas`,
      `💰 *${fmt(resumo.total_arrecadado)}* arrecadado`,
      `📈 *${fmt(resumo.total_lucro)}* de lucro *(${margem}%)*`,
      linhasPag ? `\n${linhasPag}` : '',
      ``,
      `_${agora}_`,
    ].filter(s => s !== undefined).join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

/* ── PDF ──────────────────────────────────── */
async function gerarPDF() {
  const btn = document.getElementById('btn-gerar-pdf');
  if (btn) { btn.textContent = '⏳ Gerando...'; btn.disabled = true; }
  try {
    const [itens, resumo] = await Promise.all([apiFetch('/vendas/relatorio'), apiFetch('/vendas/resumo')]);
    const agora = new Date().toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
    const totalCusto = itens.reduce((s, i) => s + Number(i.custo_total), 0);
    const margem = resumo.total_arrecadado > 0 ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) : 0;
    const pag = resumo.pagamentos || {};

    const linhas = itens.filter(i => Number(i.qtd_vendida) > 0).map(item => {
      const qtd        = Number(item.qtd_vendida);
      const receita    = Number(item.receita);
      const custoTotal = Number(item.custo_total);
      const lucro      = Number(item.lucro);
      const precoUnit  = qtd > 0 ? receita / qtd : 0;
      const custoUnit  = qtd > 0 ? custoTotal / qtd : 0;
      const lucroUnit  = qtd > 0 ? lucro / qtd : 0;
      return `<tr>
        <td>${item.nome}</td>
        <td class="num">${qtd}</td>
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
<title>Relatório – Caixa UNIFSP</title>
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
<h1>Caixa UNIFSP</h1>
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
<p class="footer">Caixa UNIFSP · ${agora}</p>
</body>
</html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  } catch (e) { showToast('Erro ao gerar PDF: ' + e.message, 'error-toast'); }
  finally { if (btn) { btn.textContent = '📄 Gerar PDF'; btn.disabled = false; } }
}

/* ── Init ─────────────────────────────────── */
document.getElementById('new-price').addEventListener('input', atualizarMargem);
document.getElementById('new-cost').addEventListener('input', atualizarMargem);

document.addEventListener('DOMContentLoaded', () => {
  updateTabPill('venda', true);
  updateBnavPill('venda', true);
  carregarTudo();
  setupFormEnter();
});

setInterval(async () => {
  const a = document.querySelector('.section.active').id;
  if (a === 'tab-venda') { await carregarProdutos(); await carregarResumo(); }
}, 10000);
