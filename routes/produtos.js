const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM produtos ORDER BY nome');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nome, emoji, preco, custo, estoque, estoque_minimo } = req.body;
  if (!nome || preco == null || estoque == null)
    return res.status(400).json({ error: 'nome, preco e estoque são obrigatórios' });
  try {
    const [result] = await db.query(
      'INSERT INTO produtos (nome, emoji, preco, custo, estoque, estoque_minimo) VALUES (?, ?, ?, ?, ?, ?)',
      [nome, emoji || '🍺', preco, custo || 0, estoque, estoque_minimo || 5]
    );
    const [rows] = await db.query('SELECT * FROM produtos WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/estoque', async (req, res) => {
  const { delta } = req.body;
  try {
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
    const [[{ cnt }]] = await db.query('SELECT COUNT(*) as cnt FROM venda_itens WHERE produto_id = ?', [req.params.id]);
    if (cnt > 0) return res.status(400).json({ error: 'Produto tem vendas registradas. Exclua as vendas primeiro.' });
    await db.query('DELETE FROM produtos WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
