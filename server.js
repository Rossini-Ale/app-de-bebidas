require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const produtosRouter = require('./routes/produtos');
const vendasRouter   = require('./routes/vendas');

const app  = express();
const PORT = process.env.PORT || 3000;

const SENHA_HASH = bcrypt.hashSync(process.env.APP_SENHA || 'unifsp2025', 10);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'caixa-unifsp-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

/* ── Auth routes (public) ─────────────────── */
app.post('/api/auth/login', async (req, res) => {
  const { evento, senha } = req.body;
  if (!evento || !senha) return res.status(400).json({ error: 'Informe o evento e a senha' });
  if (!bcrypt.compareSync(senha, SENHA_HASH)) return res.status(401).json({ error: 'Senha incorreta' });
  try {
    const [existentes] = await db.query('SELECT id, nome FROM eventos WHERE nome = ?', [evento.trim()]);
    let ev;
    if (existentes.length > 0) {
      ev = existentes[0];
    } else {
      const [r] = await db.query('INSERT INTO eventos (nome) VALUES (?)', [evento.trim()]);
      ev = { id: r.insertId, nome: evento.trim() };
    }
    req.session.eventoId   = ev.id;
    req.session.eventoNome = ev.nome;
    res.json({ ok: true, evento: ev });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.eventoId) return res.status(401).json({ error: 'Não autenticado' });
  res.json({ id: req.session.eventoId, nome: req.session.eventoNome });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* ── Auth middleware ──────────────────────── */
function requireAuth(req, res, next) {
  if (!req.session.eventoId) return res.status(401).json({ error: 'Não autenticado' });
  req.eventoId = req.session.eventoId;
  next();
}

app.use('/api/produtos', requireAuth, produtosRouter);
app.use('/api/vendas',   requireAuth, vendasRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ── DB connect + migrations ──────────────── */
db.getConnection()
  .then(async conn => {
    conn.release();
    await runMigrations();
    console.log('✅ MySQL conectado!');
    app.listen(PORT, () => console.log(`🤠 Servidor na porta ${PORT}`));
  })
  .catch(err => { console.error('❌ Erro MySQL:', err.message); process.exit(1); });

async function runMigrations() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS eventos (
      id   INT AUTO_INCREMENT PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const [[{ cnt }]] = await db.query('SELECT COUNT(*) as cnt FROM eventos');
  if (Number(cnt) === 0) {
    await db.query("INSERT INTO eventos (id, nome) VALUES (1, 'Padrão')");
  }
  for (const tbl of ['produtos', 'vendas']) {
    try { await db.query(`ALTER TABLE ${tbl} ADD COLUMN evento_id INT NOT NULL DEFAULT 1`); } catch (_) {}
    await db.query(`UPDATE ${tbl} SET evento_id = 1 WHERE evento_id IS NULL OR evento_id = 0`);
  }
  try { await db.query(`ALTER TABLE vendas ADD COLUMN forma_pagamento VARCHAR(10) NOT NULL DEFAULT 'dinheiro'`); } catch (_) {}
}
