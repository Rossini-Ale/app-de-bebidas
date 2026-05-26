require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const produtosRouter = require('./routes/produtos');
const vendasRouter = require('./routes/vendas');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/produtos', produtosRouter);
app.use('/api/vendas', vendasRouter);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

db.getConnection()
  .then(async conn => {
    conn.release();
    // Migration: adiciona forma_pagamento se não existir
    try {
      await db.query(`ALTER TABLE vendas ADD COLUMN forma_pagamento VARCHAR(10) NOT NULL DEFAULT 'dinheiro'`);
    } catch (_) { /* coluna já existe */ }
    console.log('✅ MySQL conectado!');
    app.listen(PORT, () => console.log(`🤠 Servidor na porta ${PORT}`));
  })
  .catch(err => {
    console.error('❌ Erro MySQL:', err.message);
    process.exit(1);
  });
