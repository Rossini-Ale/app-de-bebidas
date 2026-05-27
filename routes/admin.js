const express = require('express');
const router  = express.Router();
const db      = require('../db');
const appEvents = require('../events');

/* GET /api/admin/status — contagem de vendas e reposições do evento */
router.get('/status', async (req, res) => {
  try {
    const [[{ vendas }]]    = await db.query('SELECT COUNT(*) as vendas FROM vendas WHERE evento_id = ?', [req.eventoId]);
    const [[{ reposicoes }]] = await db.query('SELECT COUNT(*) as reposicoes FROM reposicoes WHERE evento_id = ?', [req.eventoId]);
    res.json({ vendas: Number(vendas), reposicoes: Number(reposicoes) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/admin/zerar-historico — limpa vendas e reposições, mantém produtos */
router.delete('/zerar-historico', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Conta antes de apagar (para retornar no resultado)
    const [[{ vendas }]]    = await conn.query('SELECT COUNT(*) as vendas FROM vendas WHERE evento_id = ?', [req.eventoId]);
    const [[{ reposicoes }]] = await conn.query('SELECT COUNT(*) as reposicoes FROM reposicoes WHERE evento_id = ?', [req.eventoId]);

    // venda_itens tem ON DELETE CASCADE, apaga junto com vendas
    await conn.query('DELETE FROM vendas WHERE evento_id = ?', [req.eventoId]);
    await conn.query('DELETE FROM reposicoes WHERE evento_id = ?', [req.eventoId]);

    await conn.commit();
    appEvents.emit('broadcast', { type: 'historico_zerado' });
    res.json({ ok: true, vendas: Number(vendas), reposicoes: Number(reposicoes) });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
