const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../db');
const appEvents = require('../events');

/* GET /api/admin/status — contagem de vendas, reposições e disponibilidade de sync */
router.get('/status', async (req, res) => {
  try {
    const [[{ vendas }]]     = await db.query('SELECT COUNT(*) as vendas FROM vendas WHERE evento_id = ?', [req.eventoId]);
    const [[{ reposicoes }]] = await db.query('SELECT COUNT(*) as reposicoes FROM reposicoes WHERE evento_id = ?', [req.eventoId]);
    res.json({
      vendas:         Number(vendas),
      reposicoes:     Number(reposicoes),
      syncDisponivel: !!(process.env.RAILWAY_URL),   // só true quando RAILWAY_URL está no .env
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* DELETE /api/admin/zerar-historico — limpa vendas e reposições, mantém produtos */
router.delete('/zerar-historico', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[{ vendas }]]     = await conn.query('SELECT COUNT(*) as vendas FROM vendas WHERE evento_id = ?', [req.eventoId]);
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

/* POST /api/admin/sync-railway — puxa estoque atual do Railway e atualiza local
 *
 * Estratégia: UPDATE por nome (não por id), para preservar os IDs locais
 * e não quebrar referências de vendas já feitas no local.
 * Produtos novos no Railway são inseridos; produtos só no local são mantidos.
 */
router.post('/sync-railway', async (req, res) => {
  const railwayUrl   = process.env.RAILWAY_URL;
  const railwaySenha = process.env.RAILWAY_SENHA || process.env.APP_SENHA || 'unifsp2026';

  if (!railwayUrl) {
    return res.status(400).json({ error: 'RAILWAY_URL não configurada no .env' });
  }

  try {
    // 1. Login no Railway
    const loginRes = await fetch(`${railwayUrl}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ operador: 'sync', senha: railwaySenha }),
    });

    if (!loginRes.ok) {
      const err = await loginRes.json().catch(() => ({}));
      return res.status(502).json({ error: 'Login no Railway falhou: ' + (err.error || loginRes.status) });
    }

    const cookieHeader = loginRes.headers.getSetCookie()
      .map(c => c.split(';')[0].trim()).join('; ');

    // 2. Buscar produtos do Railway
    const prodRes = await fetch(`${railwayUrl}/api/produtos`, {
      headers: { 'Cookie': cookieHeader },
    });

    if (!prodRes.ok) {
      return res.status(502).json({ error: 'Erro ao buscar produtos do Railway: ' + prodRes.status });
    }

    const remoteProdutos = await prodRes.json();

    // 3. Buscar produtos locais para comparar por nome
    const [localProdutos] = await db.query(
      'SELECT id, nome FROM produtos WHERE evento_id = ?', [req.eventoId]
    );
    const localPorNome = {};
    localProdutos.forEach(p => { localPorNome[p.nome.toLowerCase()] = p.id; });

    let atualizados = 0;
    let inseridos   = 0;

    for (const p of remoteProdutos) {
      const nomeKey = p.nome.toLowerCase();

      if (localPorNome[nomeKey]) {
        // Produto existe localmente → atualiza campos (inclusive estoque atual)
        await db.query(
          `UPDATE produtos SET
            emoji = ?, preco = ?, custo = ?, estoque = ?, estoque_minimo = ?,
            categoria = ?, combo_qtd = ?, combo_preco = ?,
            dose_ml = ?, garrafa_ml = ?, garrafa_preco = ?, unidades_por_fardo = ?
           WHERE id = ?`,
          [
            p.emoji          || '🍺',
            p.preco          || 0,
            p.custo          || 0,
            p.estoque        || 0,
            p.estoque_minimo || 5,
            p.categoria      || '',
            p.combo_qtd          ?? null,
            p.combo_preco        ?? null,
            p.dose_ml            ?? null,
            p.garrafa_ml         ?? null,
            p.garrafa_preco      ?? null,
            p.unidades_por_fardo ?? null,
            localPorNome[nomeKey],
          ]
        );
        atualizados++;
      } else {
        // Produto novo no Railway → insere localmente
        await db.query(
          `INSERT INTO produtos
             (nome, emoji, preco, custo, estoque, estoque_minimo, evento_id,
              categoria, combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco, unidades_por_fardo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.nome,
            p.emoji          || '🍺',
            p.preco          || 0,
            p.custo          || 0,
            p.estoque        || 0,
            p.estoque_minimo || 5,
            req.eventoId,
            p.categoria      || '',
            p.combo_qtd          ?? null,
            p.combo_preco        ?? null,
            p.dose_ml            ?? null,
            p.garrafa_ml         ?? null,
            p.garrafa_preco      ?? null,
            p.unidades_por_fardo ?? null,
          ]
        );
        inseridos++;
      }
    }

    // 4. Buscar vendas locais com seus itens (nome do produto para mapeamento no Railway)
    const [vendaRows] = await db.query(`
      SELECT v.id, v.total, v.itens_count, v.descricao, v.forma_pagamento,
             v.operador, v.ao_custo, v.observacao, v.sync_key, v.criado_em,
             vi.quantidade, vi.preco_unitario, p.nome AS produto_nome
      FROM vendas v
      JOIN venda_itens vi ON vi.venda_id = v.id
      JOIN produtos p    ON vi.produto_id = p.id
      WHERE v.evento_id = ? AND v.sync_key IS NOT NULL
      ORDER BY v.id, vi.id
    `, [req.eventoId]);

    // Agrupa por venda
    const vendasMap = {};
    for (const row of vendaRows) {
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

    // 5. Empurrar vendas locais → Railway (tolerante: Railway pode não ter o endpoint ainda)
    let vendasEnviadas = 0, vendasIgnoradasEnvio = 0;
    const vendasArray = Object.values(vendasMap);

    if (vendasArray.length > 0) {
      try {
        const syncVendasRes = await fetch(`${railwayUrl}/api/vendas/sync-import`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Cookie': cookieHeader },
          body:    JSON.stringify(vendasArray),
        });
        const ct = syncVendasRes.headers.get('content-type') || '';
        if (syncVendasRes.ok && ct.includes('application/json')) {
          const syncData       = await syncVendasRes.json();
          vendasEnviadas       = syncData.importadas || 0;
          vendasIgnoradasEnvio = syncData.ignoradas  || 0;
        }
      } catch (_) { /* Railway sem suporte a vendas — ignora */ }
    }

    // 6. Puxar vendas do Railway → local (tolerante)
    let vendasRecebidas = 0, vendasIgnoradasRecebimento = 0;
    let railwayVendas = [];
    try {
      const exportRes = await fetch(`${railwayUrl}/api/vendas/sync-export`, {
        headers: { 'Cookie': cookieHeader },
      });
      const ct = exportRes.headers.get('content-type') || '';
      if (exportRes.ok && ct.includes('application/json')) {
        railwayVendas = await exportRes.json();
      }
    } catch (_) { /* Railway sem suporte a vendas — ignora */ }

    if (railwayVendas.length > 0) {
      // Mapa nome → id dos produtos locais
      const [localProds] = await db.query('SELECT id, nome FROM produtos WHERE evento_id = ?', [req.eventoId]);
      const nomePorIdLocal = {};
      localProds.forEach(p => { nomePorIdLocal[p.nome.toLowerCase()] = p.id; });

      for (const v of railwayVendas) {
        if (!v.sync_key) { vendasIgnoradasRecebimento++; continue; }
        const [[existe]] = await db.query('SELECT id FROM vendas WHERE sync_key = ?', [v.sync_key]);
        if (existe) { vendasIgnoradasRecebimento++; continue; }

        const conn = await db.getConnection();
        try {
          await conn.beginTransaction();
          const [result] = await conn.query(
            `INSERT INTO vendas (total, itens_count, descricao, forma_pagamento, evento_id, operador, ao_custo, observacao, sync_key, criado_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [v.total, v.itens_count, v.descricao, v.forma_pagamento, req.eventoId,
             v.operador || 'Railway', v.ao_custo ? 1 : 0, v.observacao || null, v.sync_key, v.criado_em]
          );
          for (const item of (v.itens || [])) {
            const prodId = nomePorIdLocal[item.nome?.toLowerCase()];
            if (!prodId) continue;
            await conn.query(
              'INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)',
              [result.insertId, prodId, item.quantidade, item.preco_unitario]
            );
          }
          await conn.commit();
          vendasRecebidas++;
        } catch (_) {
          await conn.rollback();
          vendasIgnoradasRecebimento++;
        } finally {
          conn.release();
        }
      }
    }

    // 7. Notificar todos os dispositivos conectados
    appEvents.emit('broadcast', { type: 'sync_railway_concluido' });

    res.json({
      ok: true,
      atualizados, inseridos, total: remoteProdutos.length,
      vendasEnviadas, vendasRecebidas,
    });
  } catch (err) {
    // Erro de rede (internet caiu) → mensagem amigável
    if (err.cause?.code === 'ECONNREFUSED' || err.message.includes('fetch')) {
      return res.status(503).json({ error: 'Sem conexão com o Railway. Verifique a internet.' });
    }
    res.status(500).json({ error: err.message });
  }
});

/* GET /api/admin/fundo — fundo de caixa do evento */
router.get('/fundo', async (req, res) => {
  try {
    const [[ev]] = await db.query('SELECT fundo_caixa FROM eventos WHERE id = ?', [req.eventoId]);
    res.json({ fundo: Number(ev?.fundo_caixa) || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/admin/fundo — salva fundo de caixa */
router.post('/fundo', async (req, res) => {
  const fundo = parseFloat(req.body.fundo) || 0;
  try {
    await db.query('UPDATE eventos SET fundo_caixa = ? WHERE id = ?', [fundo, req.eventoId]);
    res.json({ ok: true, fundo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/admin/evento-nome — renomeia o evento */
router.post('/evento-nome', async (req, res) => {
  const nome = (req.body.nome || '').trim();
  if (!nome) return res.status(400).json({ error: 'Nome não pode ser vazio' });
  try {
    await db.query('UPDATE eventos SET nome = ? WHERE id = ?', [nome, req.eventoId]);
    appEvents.emit('broadcast', { type: 'evento_renomeado', nome });
    res.json({ ok: true, nome });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* POST /api/admin/senha — altera a senha do app */
router.post('/senha', async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;
  if (!senhaAtual || !novaSenha)
    return res.status(400).json({ error: 'Preencha todos os campos' });
  if (novaSenha.length < 4)
    return res.status(400).json({ error: 'Nova senha precisa ter pelo menos 4 caracteres' });
  try {
    const [[ev]] = await db.query('SELECT senha_hash FROM eventos WHERE id = ?', [req.eventoId]);
    if (!ev?.senha_hash || !bcrypt.compareSync(senhaAtual, ev.senha_hash))
      return res.status(401).json({ error: 'Senha atual incorreta' });
    const novoHash = bcrypt.hashSync(novaSenha, 10);
    await db.query('UPDATE eventos SET senha_hash = ? WHERE id = ?', [novoHash, req.eventoId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
