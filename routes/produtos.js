const express = require('express');
const router  = express.Router();
const db      = require('../db');
const appEvents = require('../events');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM produtos WHERE evento_id = ? ORDER BY nome', [req.eventoId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nome, emoji, preco, custo, estoque, estoque_minimo, categoria } = req.body;
  if (!nome)
    return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const [result] = await db.query(
      'INSERT INTO produtos (nome, emoji, preco, custo, estoque, estoque_minimo, evento_id, categoria) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [nome, emoji || '🍺', preco || 0, custo || 0, estoque || 0, estoque_minimo || 5, req.eventoId, categoria || '']
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [result.insertId]);
    appEvents.emit('broadcast', { type: 'produto_novo', produto: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/estoque', async (req, res) => {
  const { delta, registrar } = req.body;
  try {
    const [chk] = await db.query('SELECT id FROM produtos WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!chk.length) return res.status(404).json({ error: 'Produto não encontrado' });
    await db.query(
      'UPDATE produtos SET estoque = GREATEST(0, estoque + ?) WHERE id = ?',
      [delta, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
    const produto = rows[0];

    if (registrar && delta !== 0) {
      await db.query(
        'INSERT INTO reposicoes (produto_id, quantidade, operador, evento_id) VALUES (?, ?, ?, ?)',
        [req.params.id, delta, req.operador, req.eventoId]
      );
      appEvents.emit('broadcast', { type: 'reposicao_nova' });
    }

    appEvents.emit('broadcast', { type: 'produto_atualizado', produto });
    res.json(produto);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { nome, emoji, preco, custo, estoque, estoque_minimo, categoria } = req.body;
  try {
    const [chk] = await db.query('SELECT id FROM produtos WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!chk.length) return res.status(404).json({ error: 'Produto não encontrado' });
    await db.query(
      'UPDATE produtos SET nome=?, emoji=?, preco=?, custo=?, estoque=?, estoque_minimo=?, categoria=? WHERE id=?',
      [nome, emoji, preco, custo || 0, estoque, estoque_minimo, categoria || '', req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
    appEvents.emit('broadcast', { type: 'produto_atualizado', produto: rows[0] });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const [chk] = await db.query('SELECT id FROM produtos WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!chk.length) return res.status(404).json({ error: 'Produto não encontrado' });
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) as cnt FROM venda_itens WHERE produto_id = ?', [req.params.id]);
    if (cnt > 0) return res.status(400).json({ error: 'Produto tem vendas registradas.' });
    await db.query('DELETE FROM produtos WHERE id = ?', [req.params.id]);
    appEvents.emit('broadcast', { type: 'produto_deletado', id: Number(req.params.id) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reposicoes', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, p.nome as produto_nome
       FROM reposicoes r
       JOIN produtos p ON r.produto_id = p.id
       WHERE r.evento_id = ?
       ORDER BY r.criado_em DESC
       LIMIT 100`,
      [req.eventoId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
