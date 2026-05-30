require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session      = require('express-session');
const MySQLStore   = require('express-mysql-session')(session);
const bcrypt = require('bcryptjs');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const db = require('./db');
const appEvents = require('./events');

const produtosRouter = require('./routes/produtos');
const vendasRouter   = require('./routes/vendas');
const adminRouter    = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 3000;

const SENHA_HASH = bcrypt.hashSync(process.env.APP_SENHA || 'unifsp2026', 10);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ── Sessões persistidas no MySQL ─────────────── */
const sessionStore = new MySQLStore({
  host:               process.env.DB_HOST     || 'localhost',
  port:               process.env.DB_PORT     || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'caixa_unifsp',
  clearExpired:       true,   // apaga sessões expiradas automaticamente
  checkExpirationInterval: 60 * 60 * 1000, // verifica a cada 1 hora
  expiration:         12 * 60 * 60 * 1000, // sessão dura 12 horas
  createDatabaseTable: true,  // cria tabela sessions se não existir
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'caixa-unifsp-secret-key',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { maxAge: 12 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

/* ── Auth routes (public) ─────────────────────── */
app.post('/api/auth/login', async (req, res) => {
  const { operador, senha } = req.body;
  if (!operador || !senha) return res.status(400).json({ error: 'Informe seu nome e a senha' });
  try {
    const [[ev]] = await db.query('SELECT nome, senha_hash FROM eventos WHERE id = 1');
    const hashToCheck = ev?.senha_hash || SENHA_HASH;
    if (!bcrypt.compareSync(senha, hashToCheck)) return res.status(401).json({ error: 'Senha incorreta' });
    req.session.eventoId   = 1;
    req.session.eventoNome = ev?.nome || 'Caixa UNIFSP';
    req.session.operador   = operador.trim();
    res.json({ ok: true, operador: req.session.operador, eventoNome: req.session.eventoNome });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.eventoId) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const [[ev]] = await db.query('SELECT nome FROM eventos WHERE id = ?', [req.session.eventoId]);
    res.json({ operador: req.session.operador || 'Caixa', eventoNome: ev?.nome || 'Caixa UNIFSP' });
  } catch {
    res.json({ operador: req.session.operador || 'Caixa', eventoNome: 'Caixa UNIFSP' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* ── Auth middleware ──────────────────────────── */
function requireAuth(req, res, next) {
  if (!req.session.eventoId) return res.status(401).json({ error: 'Não autenticado' });
  req.eventoId  = req.session.eventoId;
  req.operador  = req.session.operador || 'Caixa';
  next();
}

app.use('/api/produtos', requireAuth, produtosRouter);
app.use('/api/vendas',   requireAuth, vendasRouter);
app.use('/api/admin',    requireAuth, adminRouter);

/* ── Cardápio público (sem autenticação) ── */
app.get('/api/publico/evento', async (_req, res) => {
  try {
    const [[ev]] = await db.query('SELECT nome FROM eventos WHERE id = 1');
    res.json({ nome: ev?.nome || 'Cardápio' });
  } catch (err) { res.json({ nome: 'Cardápio' }); }
});

app.get('/api/publico/produtos', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nome, emoji, preco, custo, estoque, categoria, combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco FROM produtos WHERE evento_id = 1 ORDER BY categoria, nome'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/cardapio', (req, res) => res.sendFile(path.join(__dirname, 'public', 'cardapio.html')));

app.get('/api/publico/cardapio-qr', async (req, res) => {
  try {
    const host = req.get('host');
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const url = `${proto}://${host}/cardapio`;
    const svg = await QRCode.toString(url, { type: 'svg', margin: 2, width: 300 });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ── DB connect + migrations ──────────────── */
db.getConnection()
  .then(async conn => {
    conn.release();
    await runMigrations();
    console.log('✅ MySQL conectado!');

    const server = http.createServer(app);

    /* ── WebSocket Server ──────────────────── */
    const wss = new WebSocketServer({ server });

    appEvents.on('broadcast', (msg) => {
      const data = JSON.stringify(msg);
      wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
          client.send(data);
        }
      });
    });

    wss.on('connection', (ws) => {
      ws.on('error', () => {});
    });

    server.listen(PORT, () => console.log(`🤠 Servidor na porta ${PORT}`));
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
    await db.query(`UPDATE ${tbl} SET evento_id = 1`);
  }
  try { await db.query(`ALTER TABLE vendas ADD COLUMN forma_pagamento VARCHAR(10) NOT NULL DEFAULT 'dinheiro'`); } catch (_) {}
  try { await db.query(`ALTER TABLE vendas ADD COLUMN operador VARCHAR(50) NOT NULL DEFAULT 'Caixa'`); } catch (_) {}
  try { await db.query(`ALTER TABLE vendas ADD COLUMN ao_custo BOOLEAN NOT NULL DEFAULT FALSE`); } catch (_) {}

  /* ── Reposições ──────────────────────────── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS reposicoes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      produto_id INT NOT NULL,
      quantidade INT NOT NULL,
      operador VARCHAR(50) NOT NULL DEFAULT 'Caixa',
      evento_id INT NOT NULL DEFAULT 1,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  try { await db.query(`ALTER TABLE reposicoes ADD COLUMN evento_id INT NOT NULL DEFAULT 1`); } catch (_) {}

  /* ── Categorias ──────────────────────────── */
  try { await db.query(`ALTER TABLE produtos ADD COLUMN categoria VARCHAR(50) NOT NULL DEFAULT ''`); } catch (_) {}

  /* ── Combos por quantidade ───────────────── */
  try { await db.query(`ALTER TABLE produtos ADD COLUMN combo_qtd INT DEFAULT NULL`); } catch (_) {}
  try { await db.query(`ALTER TABLE produtos ADD COLUMN combo_preco DECIMAL(10,2) DEFAULT NULL`); } catch (_) {}

  /* ── Venda por dose ──────────────────────── */
  try { await db.query(`ALTER TABLE produtos ADD COLUMN dose_ml INT DEFAULT NULL`); } catch (_) {}
  try { await db.query(`ALTER TABLE produtos ADD COLUMN garrafa_ml INT DEFAULT NULL`); } catch (_) {}
  try { await db.query(`ALTER TABLE produtos ADD COLUMN garrafa_preco DECIMAL(10,2) DEFAULT NULL`); } catch (_) {}

  /* ── Fardo ───────────────────────────────── */
  try { await db.query(`ALTER TABLE produtos ADD COLUMN unidades_por_fardo INT DEFAULT NULL`); } catch (_) {}

  /* ── Observação, sync key e valor recebido ─ */
  try { await db.query(`ALTER TABLE vendas ADD COLUMN valor_recebido DECIMAL(10,2) DEFAULT NULL`); } catch (_) {}
  try { await db.query(`ALTER TABLE vendas ADD COLUMN observacao VARCHAR(200) DEFAULT NULL`); } catch (_) {}
  try { await db.query(`ALTER TABLE vendas ADD COLUMN sync_key VARCHAR(64) DEFAULT NULL`); } catch (_) {}
  try { await db.query(`UPDATE vendas SET sync_key = CONCAT('legacy-', id) WHERE sync_key IS NULL`); } catch (_) {}
  try { await db.query(`ALTER TABLE vendas ADD UNIQUE INDEX idx_sync_key (sync_key)`); } catch (_) {}

  /* ── Evento: senha e fundo de caixa ─────── */
  try { await db.query(`ALTER TABLE eventos ADD COLUMN senha_hash VARCHAR(255)`); } catch (_) {}
  try { await db.query(`ALTER TABLE eventos ADD COLUMN fundo_caixa DECIMAL(10,2) NOT NULL DEFAULT 0`); } catch (_) {}
  // Inicializa senha_hash no DB a partir do ENV (se ainda não foi definida)
  const [[evCheck]] = await db.query('SELECT senha_hash FROM eventos WHERE id = 1');
  if (!evCheck?.senha_hash) {
    await db.query('UPDATE eventos SET senha_hash = ? WHERE id = 1', [SENHA_HASH]);
  }
}
