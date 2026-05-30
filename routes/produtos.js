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

/* POST /api/produtos/sync-import — upsert em massa por nome (idempotente) */
router.post('/sync-import', async (req, res) => {
  const lista = req.body;
  if (!Array.isArray(lista)) return res.status(400).json({ error: 'Esperado array de produtos' });

  try {
    const [existentes] = await db.query('SELECT id, nome FROM produtos WHERE evento_id = ?', [req.eventoId]);
    const porNome = {};
    existentes.forEach(p => { porNome[p.nome.toLowerCase()] = p.id; });

    let atualizados = 0, inseridos = 0;
    for (const p of lista) {
      const key = p.nome?.toLowerCase();
      if (!key) continue;
      if (porNome[key]) {
        await db.query(
          `UPDATE produtos SET emoji=?,preco=?,custo=?,estoque=?,estoque_minimo=?,categoria=?,
           combo_qtd=?,combo_preco=?,dose_ml=?,garrafa_ml=?,garrafa_preco=?,unidades_por_fardo=?
           WHERE id=?`,
          [
            p.emoji || '🍺', p.preco || 0, p.custo || 0, p.estoque || 0, p.estoque_minimo || 0,
            p.categoria || '', p.combo_qtd ?? null, p.combo_preco ?? null,
            p.dose_ml ?? null, p.garrafa_ml ?? null, p.garrafa_preco ?? null, p.unidades_por_fardo ?? null,
            porNome[key],
          ]
        );
        atualizados++;
      } else {
        await db.query(
          `INSERT INTO produtos
             (nome, emoji, preco, custo, estoque, estoque_minimo, categoria,
              combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco, unidades_por_fardo, evento_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            p.nome, p.emoji || '🍺', p.preco || 0, p.custo || 0, p.estoque || 0, p.estoque_minimo || 0,
            p.categoria || '', p.combo_qtd ?? null, p.combo_preco ?? null,
            p.dose_ml ?? null, p.garrafa_ml ?? null, p.garrafa_preco ?? null, p.unidades_por_fardo ?? null,
            req.eventoId,
          ]
        );
        inseridos++;
      }
    }
    res.json({ ok: true, atualizados, inseridos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  const { nome, emoji, preco, custo, estoque, estoque_minimo, categoria, combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco, unidades_por_fardo } = req.body;
  if (!nome)
    return res.status(400).json({ error: 'Nome é obrigatório' });
  try {
    const [result] = await db.query(
      'INSERT INTO produtos (nome, emoji, preco, custo, estoque, estoque_minimo, evento_id, categoria, combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco, unidades_por_fardo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [nome, emoji || '🍺', preco || 0, custo || 0, estoque || 0, estoque_minimo || 0, req.eventoId, categoria || '', combo_qtd || null, combo_preco || null, dose_ml || null, garrafa_ml || null, garrafa_preco || null, unidades_por_fardo || null]
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
  const { nome, emoji, preco, custo, estoque, estoque_minimo, categoria, combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco, unidades_por_fardo } = req.body;
  try {
    const [chk] = await db.query('SELECT id FROM produtos WHERE id = ? AND evento_id = ?', [req.params.id, req.eventoId]);
    if (!chk.length) return res.status(404).json({ error: 'Produto não encontrado' });
    await db.query(
      'UPDATE produtos SET nome=?, emoji=?, preco=?, custo=?, estoque=?, estoque_minimo=?, categoria=?, combo_qtd=?, combo_preco=?, dose_ml=?, garrafa_ml=?, garrafa_preco=?, unidades_por_fardo=? WHERE id=?',
      [nome, emoji, preco, custo || 0, estoque, estoque_minimo, categoria || '', combo_qtd || null, combo_preco || null, dose_ml || null, garrafa_ml || null, garrafa_preco || null, unidades_por_fardo || null, req.params.id]
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
