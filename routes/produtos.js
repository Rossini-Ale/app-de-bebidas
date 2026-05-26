const express = require('express');
const router  = express.Router();
const db      = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM produtos WHERE evento_id = ? ORDER BY nome', [req.eventoId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nome, emoji, preco, custo, estoque, estoque_minimo } = req.body;
  if (!nome || preco == null || estoque == null)
    return res.status(400).json({ error: 'nome, preco e estoque são obrigatórios' });
  try {
    const [result] = await db.query(
      'INSERT INTO produtos (nome, emoji, preco, custo, estoque, estoque_minimo, evento_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nome, emoji || '🍺', preco, custo || 0, estoque, estoque_minimo || 5, req.eventoId]
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/estoque', async (req, res) => {
  const { delta } = req.body;
  try {
    const [chk] = await db.query('SELECT id FROM produtos WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!chk.length) return res.status(404).json({ error: 'Produto não encontrado' });
    await db.query(
      'UPDATE produtos SET estoque = GREATEST(0, estoque + ?) WHERE id = ?',
      [delta, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  const { nome, emoji, preco, custo, estoque, estoque_minimo } = req.body;
  try {
    const [chk] = await db.query('SELECT id FROM produtos WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!chk.length) return res.status(404).json({ error: 'Produto não encontrado' });
    await db.query(
      'UPDATE produtos SET nome=?, emoji=?, preco=?, custo=?, estoque=?, estoque_minimo=? WHERE id=?',
      [nome, emoji, preco, custo || 0, estoque, estoque_minimo, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [req.params.id]);
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
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
