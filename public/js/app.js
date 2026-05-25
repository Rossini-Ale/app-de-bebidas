const API = '';
let produtos = [], carrinho = [];

function fmt(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
function fmtShort(v) { return 'R$' + Math.round(v); }

const AVATAR_COLORS = ['#D97706','#059669','#0284C7','#7C3AED','#DB2777','#0891B2','#65A30D','#DC2626'];
function avatarColor(nome) {
  return AVATAR_COLORS[(nome || ' ').toUpperCase().charCodeAt(0) % AVATAR_COLORS.length];
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

function showToast(msg, tipo = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 2800);
}

function showTab(tab) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab, .bnav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll(`[data-tab="${tab}"]`).forEach(t => t.classList.add('active'));
  if (tab === 'estoque') renderEstoque();
  if (tab === 'historico') carregarHistorico();
  if (tab === 'relatorio') carregarRelatorio();
  if (tab === 'venda') { carregarProdutos(); carregarResumo(); }
  atualizarCartBar();
}

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

async function carregarProdutos() {
  try {
    produtos = await apiFetch('/produtos');
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
  l.innerHTML = '<div class="produto-grid">' + produtos.map(p => {
    const noStock = p.estoque === 0;
    const itemCarrinho = carrinho.find(c => c.id === p.id);
    const inCart = !!itemCarrinho;
    const badge = inCart ? `<span class="pc-badge">${itemCarrinho.qty}</span>` : '';
    const stockLabel = noStock ? 'Sem estoque' : p.estoque + ' un.';
    const classes = ['produto-card', noStock ? 'no-stock' : '', inCart ? 'in-cart' : ''].filter(Boolean).join(' ');
    const onclick = noStock ? '' : `onclick="addCarrinho(${p.id})"`;
    return `<div class="${classes}" ${onclick}>
      ${badge}
      <div class="pc-avatar" style="background:${avatarColor(p.nome)}">${p.nome[0].toUpperCase()}</div>
      <div class="pc-nome">${p.nome}</div>
      <div class="pc-preco">${fmt(p.preco)}</div>
      <div class="pc-stock">${stockLabel}</div>
      <button class="pc-btn" ${noStock ? 'disabled' : ''}>+</button>
    </div>`;
  }).join('') + '</div>';
}

function renderEstoque() {
  const l = document.getElementById('stock-list');
  const al = produtos.filter(p => p.estoque <= p.estoque_minimo).length;
  document.getElementById('m-produtos').textContent = produtos.length;
  document.getElementById('m-alertas').textContent = al;
  if (!produtos.length) {
    l.innerHTML = '<div class="empty-state">Nenhum produto ainda</div>';
    return;
  }
  l.innerHTML = produtos.map(p => {
    const low = p.estoque <= p.estoque_minimo;
    const margem = p.custo > 0 ? Math.round(((p.preco - p.custo) / p.preco) * 100) : null;
    return `<div class="stock-item">
      <div class="stock-avatar" style="background:${avatarColor(p.nome)}">${p.nome[0].toUpperCase()}</div>
      <div class="stock-info">
        <div class="stock-name">${p.nome}${low ? '<span class="badge-low">estoque baixo</span>' : ''}</div>
        <div class="stock-sub">Venda ${fmt(p.preco)} · Custo ${fmt(p.custo)} · alerta em ${p.estoque_minimo} un.</div>
        ${margem !== null ? `<div class="stock-margin">Margem: ${margem}%</div>` : ''}
      </div>
      <div class="stock-qty">
        <button class="qty-btn" onclick="ajustarEstoque(${p.id}, -1)">−</button>
        <span class="qty-num ${low ? 'qty-low' : ''}">${p.estoque}</span>
        <button class="qty-btn" onclick="ajustarEstoque(${p.id}, +1)">+</button>
      </div>
    </div>`;
  }).join('');
}

async function ajustarEstoque(id, delta) {
  try {
    const a = await apiFetch(`/produtos/${id}/estoque`, { method: 'PATCH', body: JSON.stringify({ delta }) });
    const i = produtos.findIndex(p => p.id === id);
    if (i >= 0) produtos[i] = a;
    renderEstoque();
    renderVenda();
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

function atualizarMargem() {
  const preco = parseFloat(document.getElementById('new-price').value);
  const custo = parseFloat(document.getElementById('new-cost').value);
  const hint = document.getElementById('margin-hint');
  if (!isNaN(preco) && !isNaN(custo) && preco > 0) {
    const margem = Math.round(((preco - custo) / preco) * 100);
    const lucroUnit = (preco - custo).toFixed(2).replace('.', ',');
    hint.textContent = `Margem: ${margem}% (R$${lucroUnit})`;
    hint.style.color = margem >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    hint.textContent = 'Margem: —';
    hint.style.color = 'var(--green)';
  }
}

document.getElementById('new-price').addEventListener('input', atualizarMargem);
document.getElementById('new-cost').addEventListener('input', atualizarMargem);

async function addProduto() {
  const nome = document.getElementById('new-name').value.trim();
  const preco = parseFloat(document.getElementById('new-price').value);
  const custo = parseFloat(document.getElementById('new-cost').value) || 0;
  const estoque = parseInt(document.getElementById('new-qty').value);
  const estoque_minimo = parseInt(document.getElementById('new-alert').value) || 5;
  if (!nome || isNaN(preco) || isNaN(estoque)) {
    showToast('⚠ Preencha nome, preço e quantidade', 'error-toast');
    return;
  }
  try {
    const novo = await apiFetch('/produtos', { method: 'POST', body: JSON.stringify({ nome, preco, custo, estoque, estoque_minimo }) });
    produtos.push(novo);
    ['new-name', 'new-price', 'new-cost', 'new-qty', 'new-alert'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('margin-hint').textContent = 'Margem: —';
    renderEstoque();
    renderVenda();
    showToast('✓ ' + nome + ' adicionado!', 'green-toast');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

function addCarrinho(id) {
  const p = produtos.find(x => x.id === id);
  if (!p || p.estoque === 0) return;
  const ex = carrinho.find(c => c.id === id);
  if (ex && ex.qty >= p.estoque) { showToast('⚠ Estoque insuficiente'); return; }
  if (ex) ex.qty++;
  else carrinho.push({ id, qty: 1 });
  renderCarrinho();
}

function removeCarrinho(id) {
  const i = carrinho.findIndex(c => c.id === id);
  if (i >= 0) {
    if (carrinho[i].qty > 1) carrinho[i].qty--;
    else carrinho.splice(i, 1);
  }
  renderCarrinho();
}

function removeAllCarrinho(id) {
  carrinho = carrinho.filter(c => c.id !== id);
  renderCarrinho();
}

function limparCarrinho() { carrinho = []; renderCarrinho(); }

function atualizarCartBar() {
  const bar = document.getElementById('cart-bar');
  const isVenda = document.getElementById('tab-venda').classList.contains('active');
  if (!bar) return;
  if (!carrinho.length || !isVenda) {
    bar.classList.remove('visible');
    return;
  }
  const totalItens = carrinho.reduce((s, c) => s + c.qty, 0);
  const total = carrinho.reduce((s, c) => {
    const p = produtos.find(x => x.id === c.id);
    return s + p.preco * c.qty;
  }, 0);
  document.getElementById('cart-bar-info').textContent =
    `🛒 ${totalItens} ${totalItens === 1 ? 'item' : 'itens'} · ${fmt(total)}`;
  bar.classList.add('visible');
}

function renderCarrinho() {
  const itEl = document.getElementById('carrinho-itens');
  const emEl = document.getElementById('carrinho-empty');
  const ftEl = document.getElementById('carrinho-footer');
  if (!carrinho.length) {
    itEl.innerHTML = '';
    emEl.style.display = 'block';
    ftEl.style.display = 'none';
    renderVenda();
    return;
  }
  emEl.style.display = 'none';
  ftEl.style.display = 'block';
  itEl.innerHTML = carrinho.map(c => {
    const p = produtos.find(x => x.id === c.id);
    return `<div class="carrinho-item">
      <span class="ci-name">${p.nome}</span>
      <div class="ci-controls">
        <button class="ci-ctrl" onclick="removeCarrinho(${c.id})">−</button>
        <span class="ci-qty-val">${c.qty}</span>
        <button class="ci-ctrl" onclick="addCarrinho(${c.id})">+</button>
      </div>
      <span class="ci-price">${fmt(p.preco * c.qty)}</span>
      <button class="ci-remove" onclick="removeAllCarrinho(${c.id})">✕</button>
    </div>`;
  }).join('');
  const total = carrinho.reduce((s, c) => { const p = produtos.find(x => x.id === c.id); return s + p.preco * c.qty; }, 0);
  document.getElementById('carrinho-total').textContent = fmt(total);
  renderVenda();
  atualizarCartBar();
}

async function finalizarVenda() {
  if (!carrinho.length) return;
  const itens = carrinho.map(c => ({ produto_id: c.id, quantidade: c.qty }));
  try {
    await apiFetch('/vendas', { method: 'POST', body: JSON.stringify({ itens }) });
    const total = carrinho.reduce((s, c) => { const p = produtos.find(x => x.id === c.id); return s + p.preco * c.qty; }, 0);
    carrinho = [];
    renderCarrinho();
    await carregarProdutos();
    await carregarResumo();
    showToast('✓ Venda de ' + fmt(total) + ' registrada!', 'green-toast');
  } catch (e) { showToast('Erro: ' + e.message, 'error-toast'); }
}

async function deletarVenda(id, btn) {
  if (!btn.classList.contains('confirming')) {
    btn.classList.add('confirming');
    btn.textContent = 'Confirmar?';
    btn._timer = setTimeout(() => {
      btn.classList.remove('confirming');
      btn.textContent = '🗑 Excluir';
    }, 3000);
    return;
  }
  clearTimeout(btn._timer);
  btn.textContent = '…';
  btn.disabled = true;
  try {
    await apiFetch(`/vendas/${id}`, { method: 'DELETE' });
    document.getElementById(`hist-${id}`)?.remove();
    await carregarProdutos();
    await carregarResumo();
    showToast('Venda removida', 'green-toast');
    const lista = document.getElementById('historico-lista');
    if (!lista.querySelector('.historico-item')) {
      lista.innerHTML = '<div class="empty-state">🧾<br/>Nenhuma venda ainda</div>';
    }
  } catch (e) {
    showToast('Erro: ' + e.message, 'error-toast');
    btn.classList.remove('confirming');
    btn.textContent = '🗑 Excluir';
    btn.disabled = false;
  }
}

async function carregarResumo() {
  try {
    const r = await apiFetch('/vendas/resumo');
    document.getElementById('m-vendas').textContent = r.total_vendas;
    document.getElementById('m-total').textContent = fmtShort(r.total_arrecadado);
    document.getElementById('m-lucro').textContent = fmtShort(r.total_lucro);
    document.getElementById('h-vendas').textContent = r.total_vendas;
    document.getElementById('h-total').textContent = fmtShort(r.total_arrecadado);
    document.getElementById('h-ticket').textContent = fmtShort(r.ticket_medio);
  } catch {}
}

async function carregarRelatorio() {
  const l = document.getElementById('relatorio-lista');
  l.innerHTML = '<div class="loading">Carregando...</div>';
  try {
    const [itens, resumo] = await Promise.all([apiFetch('/vendas/relatorio'), apiFetch('/vendas/resumo')]);

    document.getElementById('r-total').textContent = fmtShort(resumo.total_arrecadado);
    document.getElementById('r-lucro').textContent = fmtShort(resumo.total_lucro);
    const margem = resumo.total_arrecadado > 0
      ? Math.round((resumo.total_lucro / resumo.total_arrecadado) * 100) + '%'
      : '—';
    document.getElementById('r-margem').textContent = margem;

    if (!itens.length || itens.every(i => i.qtd_vendida == 0)) {
      l.innerHTML = '<div class="empty-state">📊<br/>Nenhuma venda registrada ainda</div>';
      return;
    }

    const maxReceita = Math.max(...itens.map(i => Number(i.receita)), 1);

    l.innerHTML = itens.map(item => {
      const receita = Number(item.receita);
      const lucro = Number(item.lucro);
      const custoTotal = Number(item.custo_total);
      const pct = Math.max(0, Math.min(100, Math.round((receita / maxReceita) * 100)));
      const isNeg = lucro < 0;
      return `<div class="relatorio-item">
        <div class="rel-header">
          <div class="rel-avatar" style="background:${avatarColor(item.nome)}">${item.nome[0].toUpperCase()}</div>
          <span class="rel-nome">${item.nome}</span>
          <span class="rel-qtd">${item.qtd_vendida} vendidos</span>
        </div>
        <div class="rel-grid">
          <div class="rel-box">
            <div class="rb-label">Receita</div>
            <div class="rb-val">${fmt(receita)}</div>
          </div>
          <div class="rel-box custo">
            <div class="rb-label">Custo</div>
            <div class="rb-val">${fmt(custoTotal)}</div>
          </div>
          <div class="rel-box lucro">
            <div class="rb-label">Lucro</div>
            <div class="rb-val" style="${isNeg ? 'color:var(--red)' : ''}">${fmt(lucro)}</div>
          </div>
        </div>
        <div class="rel-bar-wrap">
          <div class="rel-bar ${isNeg ? 'negativo' : ''}" style="width:${pct}%"></div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    l.innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`;
  }
}

async function carregarHistorico() {
  const l = document.getElementById('historico-lista');
  l.innerHTML = '<div class="loading">Carregando...</div>';
  try {
    const v = await apiFetch('/vendas');
    await carregarResumo();
    if (!v.length) {
      l.innerHTML = '<div class="empty-state">🧾<br/>Nenhuma venda ainda</div>';
      return;
    }
    l.innerHTML = v.map((venda, i) => `
      <div class="historico-item" id="hist-${venda.id}">
        <span class="hist-num">#${v.length - i}</span>
        <div class="hist-info">
          <div class="hist-desc">${venda.descricao}</div>
          <div class="hist-hora">${fmtDataHora(venda.criado_em)}</div>
        </div>
        <div class="hist-right">
          <span class="hist-total">${fmt(venda.total)}</span>
          <button class="hist-del" onclick="deletarVenda(${venda.id}, this)">🗑 Excluir</button>
        </div>
      </div>`).join('');
  } catch (e) {
    l.innerHTML = `<div class="error-msg">Erro: ${e.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', carregarTudo);

setInterval(async () => {
  const a = document.querySelector('.section.active').id;
  if (a === 'tab-venda') { await carregarProdutos(); await carregarResumo(); }
}, 30000);
