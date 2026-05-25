const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM vendas ORDER BY criado_em DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/resumo', async (req, res) => {
  try {
    const [[r]] = await db.query(`
      SELECT COUNT(*) as total_vendas,
        COALESCE(SUM(total), 0) as total_arrecadado,
        COALESCE(SUM(itens_count), 0) as total_itens,
        COALESCE(AVG(total), 0) as ticket_medio
      FROM vendas
    `);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { itens } = req.body;
  if (!itens || itens.length === 0)
    return res.status(400).json({ error: 'Nenhum item enviado' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0, totalItens = 0;
    const descricoes = [], itensFinal = [];

    for (const item of itens) {
      const [rows] = await conn.query('SELECT * FROM produtos WHERE id = ? FOR UPDATE', [item.produto_id]);
      if (!rows.length) throw new Error(`Produto ${item.produto_id} não encontrado`);
      const p = rows[0];
      if (p.estoque < item.quantidade) throw new Error(`Estoque insuficiente para "${p.nome}"`);
      total += p.preco * item.quantidade;
      totalItens += item.quantidade;
      descricoes.push(`${item.quantidade}× ${p.nome}`);
      itensFinal.push({ ...item, preco_unitario: p.preco });
    }

    const [vendaResult] = await conn.query(
      'INSERT INTO vendas (total, itens_count, descricao) VALUES (?, ?, ?)',
      [total, totalItens, descricoes.join(', ')]
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
    res.status(201).json(venda[0]);
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
