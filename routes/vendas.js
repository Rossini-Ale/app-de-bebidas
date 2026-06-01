const express = require('express');
const router  = express.Router();
const db      = require('../db');
const appEvents = require('../events');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM vendas WHERE evento_id = ? ORDER BY criado_em DESC',
      [req.eventoId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/resumo', async (req, res) => {
  try {
    const [[r]] = await db.query(`
      SELECT
        COUNT(DISTINCT v.id) as total_vendas,
        COALESCE(SUM(v.total), 0) as total_arrecadado,
        COALESCE(SUM(v.itens_count), 0) as total_itens,
        COALESCE(AVG(v.total), 0) as ticket_medio,
        COALESCE(SUM(vi.quantidade * (vi.preco_unitario - p.custo)), 0) as total_lucro,
        COUNT(DISTINCT CASE WHEN v.ao_custo = FALSE THEN v.id END) as vendas_normal,
        COUNT(DISTINCT CASE WHEN v.ao_custo = TRUE  THEN v.id END) as vendas_custo,
        COALESCE(SUM(CASE WHEN v.ao_custo = FALSE THEN v.total ELSE 0 END), 0) as arrecadado_normal,
        COALESCE(SUM(CASE WHEN v.ao_custo = TRUE  THEN v.total ELSE 0 END), 0) as arrecadado_custo
      FROM vendas v
      LEFT JOIN venda_itens vi ON vi.venda_id = v.id
      LEFT JOIN produtos p ON vi.produto_id = p.id
      WHERE v.evento_id = ?
    `, [req.eventoId]);
    const [porPag] = await db.query(
      `SELECT forma_pagamento,
        COALESCE(SUM(total),0) as total,
        COALESCE(SUM(CASE WHEN valor_recebido IS NOT NULL THEN valor_recebido ELSE total END),0) as total_recebido
       FROM vendas WHERE evento_id = ? GROUP BY forma_pagamento`,
      [req.eventoId]
    );
    const pagamentos = { dinheiro: 0, pix: 0, cartao: 0, dinheiro_recebido: 0 };
    porPag.forEach(row => {
      if (row.forma_pagamento in pagamentos) pagamentos[row.forma_pagamento] = Number(row.total);
      if (row.forma_pagamento === 'dinheiro') pagamentos.dinheiro_recebido = Number(row.total_recebido);
    });
    res.json({ ...r, pagamentos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/relatorio', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        p.id, p.nome, p.emoji, p.preco, p.custo,
        COALESCE(SUM(vi.quantidade), 0) as qtd_vendida,
        COALESCE(SUM(CASE WHEN v.ao_custo = FALSE OR v.ao_custo IS NULL THEN vi.quantidade ELSE 0 END), 0) as qtd_normal,
        COALESCE(SUM(CASE WHEN v.ao_custo = TRUE  THEN vi.quantidade ELSE 0 END), 0) as qtd_custo,
        COALESCE(SUM(vi.quantidade * vi.preco_unitario), 0) as receita,
        COALESCE(SUM(CASE WHEN v.ao_custo = FALSE OR v.ao_custo IS NULL THEN vi.quantidade * vi.preco_unitario ELSE 0 END), 0) as receita_normal,
        COALESCE(SUM(CASE WHEN v.ao_custo = TRUE  THEN vi.quantidade * vi.preco_unitario ELSE 0 END), 0) as receita_custo,
        COALESCE(SUM(vi.quantidade * p.custo), 0) as custo_total,
        COALESCE(SUM(vi.quantidade * (vi.preco_unitario - p.custo)), 0) as lucro
      FROM produtos p
      LEFT JOIN venda_itens vi ON vi.produto_id = p.id
      LEFT JOIN vendas v ON vi.venda_id = v.id AND v.evento_id = ?
      WHERE p.evento_id = ?
      GROUP BY p.id
      ORDER BY qtd_vendida DESC, p.nome ASC
    `, [req.eventoId, req.eventoId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/por-operador', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        v.operador,
        COUNT(DISTINCT v.id) as total_vendas,
        COALESCE(SUM(v.total), 0) as total_arrecadado,
        COALESCE(SUM(CASE WHEN v.ao_custo = FALSE OR v.ao_custo IS NULL THEN v.total ELSE 0 END), 0) as total_normal,
        COALESCE(SUM(CASE WHEN v.ao_custo = TRUE THEN v.total ELSE 0 END), 0) as total_custo
      FROM vendas v
      WHERE v.evento_id = ?
      GROUP BY v.operador
      ORDER BY total_arrecadado DESC
    `, [req.eventoId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* GET /api/vendas/sync-export — exporta todas as vendas com itens para sincronização */
router.get('/sync-export', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT v.id, v.total, v.itens_count, v.descricao, v.forma_pagamento,
             v.operador, v.ao_custo, v.observacao, v.sync_key, v.criado_em,
             vi.quantidade, vi.preco_unitario, p.nome AS produto_nome
      FROM vendas v
      JOIN venda_itens vi ON vi.venda_id = v.id
      JOIN produtos p    ON vi.produto_id = p.id
      WHERE v.evento_id = ? AND v.sync_key IS NOT NULL
      ORDER BY v.id, vi.id
    `, [req.eventoId]);

    const vendasMap = {};
    for (const row of rows) {
      if (!vendasMap[row.id]) {
        vendasMap[row.id] = {
          total: row.total, itens_count: row.itens_count, descricao: row.descricao,
          forma_pagamento: row.forma_pagamento, operador: row.operador,
          ao_custo: row.ao_custo, observacao: row.observacao,
          sync_key: row.sync_key, criado_em: row.criado_em, itens: []
        };
      }
      vendasMap[row.id].itens.push({
        nome: row.produto_nome, quantidade: row.quantidade, preco_unitario: row.preco_unitario
      });
    }
    res.json(Object.values(vendasMap));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/vendas/sync-repair — insere itens faltando em vendas já importadas */
router.post('/sync-repair', async (req, res) => {
  const vendas = req.body;
  if (!Array.isArray(vendas)) return res.status(400).json({ error: 'Esperado array de vendas' });

  try {
    const [prods] = await db.query('SELECT id, nome FROM produtos WHERE evento_id = ?', [req.eventoId]);
    const nomePorId = {};
    prods.forEach(p => { nomePorId[p.nome.toLowerCase()] = p.id; });

    let reparadas = 0, ignoradas = 0;

    for (const v of vendas) {
      if (!v.sync_key) { ignoradas++; continue; }
      const [[venda]] = await db.query('SELECT id FROM vendas WHERE sync_key = ?', [v.sync_key]);
      if (!venda) { ignoradas++; continue; }

      const [existentes] = await db.query('SELECT produto_id FROM venda_itens WHERE venda_id = ?', [venda.id]);
      const existenteIds = new Set(existentes.map(i => Number(i.produto_id)));

      let inseridos = 0;
      for (const item of (v.itens || [])) {
        const prodId = nomePorId[item.nome?.toLowerCase()];
        if (!prodId || existenteIds.has(prodId)) continue;
        try {
          await db.query(
            'INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)',
            [venda.id, prodId, item.quantidade, item.preco_unitario]
          );
          inseridos++;
        } catch (_) {}
      }
      if (inseridos > 0) reparadas++; else ignoradas++;
    }
    res.json({ ok: true, reparadas, ignoradas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/vendas/sync-import — importa vendas de outro servidor (idempotente via sync_key) */
router.post('/sync-import', async (req, res) => {
  const vendas = req.body;
  if (!Array.isArray(vendas)) return res.status(400).json({ error: 'Esperado array de vendas' });

  // Mapa nome → id dos produtos locais
  const [prods] = await db.query('SELECT id, nome FROM produtos WHERE evento_id = ?', [req.eventoId]);
  const nomePorId = {};
  prods.forEach(p => { nomePorId[p.nome.toLowerCase()] = p.id; });

  let importadas = 0, ignoradas = 0, primeiroErro = null;

  // Helper: converte qualquer formato de data para 'YYYY-MM-DD HH:MM:SS' que MySQL aceita
  function toMysqlDate(val) {
    if (!val) return null;
    try { return new Date(val).toISOString().slice(0, 19).replace('T', ' '); } catch (_) { return null; }
  }

  for (const v of vendas) {
    if (!v.sync_key) { ignoradas++; continue; }
    const [[existe]] = await db.query('SELECT id FROM vendas WHERE sync_key = ?', [v.sync_key]);
    if (existe) { ignoradas++; continue; }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [result] = await conn.query(
        `INSERT INTO vendas (total, itens_count, descricao, forma_pagamento, evento_id, operador, ao_custo, observacao, sync_key, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.total, v.itens_count, v.descricao, v.forma_pagamento, req.eventoId,
         v.operador || 'Sync', v.ao_custo ? 1 : 0, v.observacao || null, v.sync_key,
         toMysqlDate(v.criado_em)]
      );
      for (const item of (v.itens || [])) {
        const prodId = nomePorId[item.nome?.toLowerCase()];
        if (!prodId) continue;
        await conn.query(
          'INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)',
          [result.insertId, prodId, item.quantidade, item.preco_unitario]
        );
      }
      await conn.commit();
      importadas++;
    } catch (err) {
      await conn.rollback();
      ignoradas++;
      if (!primeiroErro) primeiroErro = err.message;
    } finally {
      conn.release();
    }
  }
  res.json({ ok: true, importadas, ignoradas, primeiroErro });
});

router.post('/', async (req, res) => {
  const { itens, forma_pagamento = 'dinheiro', ao_custo = false, observacao = null, valor_recebido = null } = req.body;
  if (!itens || itens.length === 0)
    return res.status(400).json({ error: 'Nenhum item enviado' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0, totalItens = 0;
    const descricoes = [], itensFinal = [];

    for (const item of itens) {
      const [rows] = await conn.query(
        'SELECT * FROM produtos WHERE id = ? AND evento_id = ? FOR UPDATE',
        [item.produto_id, req.eventoId]
      );
      if (!rows.length) throw new Error(`Produto ${item.produto_id} não encontrado`);
      const p = rows[0];
      if (p.estoque < item.quantidade) throw new Error(`Estoque insuficiente para "${p.nome}"`);
      const precoVenda = ao_custo ? (p.custo || 0) : p.preco;
      total += precoVenda * item.quantidade;
      totalItens += item.quantidade;
      descricoes.push(`${item.quantidade}× ${p.nome}`);
      itensFinal.push({ ...item, preco_unitario: precoVenda });
    }

    const syncKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const recebido = (forma_pagamento === 'dinheiro' && valor_recebido > total) ? valor_recebido : null;
    const [vendaResult] = await conn.query(
      'INSERT INTO vendas (total, itens_count, descricao, forma_pagamento, evento_id, operador, ao_custo, observacao, sync_key, valor_recebido) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [total, totalItens, descricoes.join(', '), forma_pagamento, req.eventoId, req.operador, ao_custo ? 1 : 0, observacao || null, syncKey, recebido]
    );

    for (const item of itensFinal) {
      await conn.query(
        'INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)',
        [vendaResult.insertId, item.produto_id, item.quantidade, item.preco_unitario]
      );
      await conn.query('UPDATE produtos SET estoque = estoque - ? WHERE id = ?', [item.quantidade, item.produto_id]);
    }

    await conn.commit();
    const [venda] = await conn.query('SELECT * FROM vendas WHERE id = ?', [vendaResult.insertId]);
    appEvents.emit('broadcast', { type: 'venda_nova', venda: venda[0] });
    res.status(201).json(venda[0]);
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

router.patch('/:id/observacao', async (req, res) => {
  const { observacao } = req.body;
  try {
    const [[v]] = await db.query('SELECT id FROM vendas WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!v) return res.status(404).json({ error: 'Venda não encontrada' });
    await db.query('UPDATE vendas SET observacao = ? WHERE id = ?', [observacao?.trim() || null, req.params.id]);
    res.json({ ok: true, observacao: observacao?.trim() || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[venda]] = await conn.query('SELECT id FROM vendas WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    const [itens] = await conn.query('SELECT * FROM venda_itens WHERE venda_id = ?', [req.params.id]);
    for (const item of itens) {
      await conn.query('UPDATE produtos SET estoque = estoque + ? WHERE id = ?', [item.quantidade, item.produto_id]);
    }
    await conn.query('DELETE FROM vendas WHERE id = ?', [req.params.id]);
    await conn.commit();
    appEvents.emit('broadcast', { type: 'venda_deletada', id: Number(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
