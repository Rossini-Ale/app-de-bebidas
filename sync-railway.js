#!/usr/bin/env node
/**
 * sync-railway.js
 * Copia os produtos do Railway (produção) para o MySQL local.
 * Use antes do evento para garantir o backup caso a internet caia.
 *
 * Uso:
 *   node sync-railway.js
 *
 * Requer no .env:
 *   RAILWAY_URL=https://seu-app.up.railway.app
 *   RAILWAY_SENHA=senha_do_app   (opcional — vai pedir se não tiver)
 */

require('dotenv').config();
const mysql    = require('mysql2/promise');
const readline = require('readline');

/* ─── Configuração ─────────────────────────────── */
const RAILWAY_URL   = process.env.RAILWAY_URL;
const RAILWAY_SENHA = process.env.RAILWAY_SENHA || process.env.APP_SENHA;

/* ─── Helpers ──────────────────────────────────── */
function perguntar(msg) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(msg, ans => { rl.close(); res(ans.trim()); }));
}

// Extrai "nome=valor" de cada Set-Cookie para reenviar como Cookie header
function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders || setCookieHeaders.length === 0) return '';
  return setCookieHeaders.map(c => c.split(';')[0].trim()).join('; ');
}

function fmt(n) { return 'R$ ' + Number(n).toFixed(2).replace('.', ','); }

/* ─── Main ─────────────────────────────────────── */
async function main() {
  console.log('\n🔄  Sincronização Railway → Local\n');

  // 1. Verificar RAILWAY_URL
  if (!RAILWAY_URL) {
    console.error('❌  RAILWAY_URL não está definida no .env');
    console.error('    Adicione esta linha ao seu .env:');
    console.error('    RAILWAY_URL=https://seu-app.up.railway.app\n');
    process.exit(1);
  }
  console.log(`📡  App no Railway: ${RAILWAY_URL}`);

  // 2. Pegar senha (env ou perguntar)
  let senha = RAILWAY_SENHA;
  if (!senha) {
    senha = await perguntar('🔑  Senha do app no Railway: ');
    if (!senha) { console.error('❌  Senha não informada.'); process.exit(1); }
  }

  // 3. Login no Railway
  process.stdout.write('🔐  Fazendo login... ');
  let loginRes;
  try {
    loginRes = await fetch(`${RAILWAY_URL}/api/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ operador: 'sync', senha }),
    });
  } catch (e) {
    console.error('\n❌  Não foi possível conectar ao Railway.');
    console.error('    Verifique a URL e sua conexão com a internet.');
    process.exit(1);
  }

  if (!loginRes.ok) {
    const err = await loginRes.json().catch(() => ({}));
    console.error('\n❌  Login falhou:', err.error || loginRes.status);
    process.exit(1);
  }

  // Capturar cookies da sessão
  const cookieHeader = parseCookies(loginRes.headers.getSetCookie());
  console.log('OK ✅');

  // 4. Buscar produtos do Railway
  process.stdout.write('📦  Buscando produtos... ');
  const prodRes = await fetch(`${RAILWAY_URL}/api/produtos`, {
    headers: { 'Cookie': cookieHeader },
  });

  if (!prodRes.ok) {
    console.error('\n❌  Erro ao buscar produtos:', prodRes.status);
    process.exit(1);
  }

  const produtos = await prodRes.json();
  console.log(`${produtos.length} encontrados ✅\n`);

  if (produtos.length === 0) {
    console.log('⚠️   Nenhum produto encontrado no Railway. Nada a importar.');
    process.exit(0);
  }

  // 5. Exibir tabela de produtos
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ Produtos que serão importados                           │');
  console.log('├────────────────────────────────────┬────────┬───────────┤');
  console.log('│ Produto                            │ Preço  │  Estoque  │');
  console.log('├────────────────────────────────────┼────────┼───────────┤');
  produtos.forEach(p => {
    const nome  = `${p.emoji || ''} ${p.nome}`.padEnd(34).slice(0, 34);
    const preco = fmt(p.preco).padStart(6);
    const est   = String(p.estoque).padStart(9);
    console.log(`│ ${nome} │ ${preco} │ ${est} │`);
  });
  console.log('└────────────────────────────────────┴────────┴───────────┘');
  console.log('');

  // 6. Confirmação
  console.log('⚠️   ATENÇÃO: todos os produtos locais serão substituídos.');
  const resp = await perguntar('    Continuar? (s/N) ');
  if (resp.toLowerCase() !== 's') {
    console.log('\n❌  Cancelado. Nada foi alterado.\n');
    process.exit(0);
  }

  // 7. Conectar ao MySQL local
  process.stdout.write('\n💾  Conectando ao MySQL local... ');
  let db;
  try {
    db = await mysql.createConnection({
      host:     process.env.DB_HOST     || 'localhost',
      port:     Number(process.env.DB_PORT) || 3306,
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME     || 'caixa_unifsp',
    });
    console.log('OK ✅');
  } catch (e) {
    console.error('\n❌  Não foi possível conectar ao MySQL local:', e.message);
    console.error('    Verifique se o MySQL está rodando: brew services start mysql');
    process.exit(1);
  }

  // 8. Limpar produtos locais e reinserir
  process.stdout.write('🔁  Importando produtos... ');
  try {
    // Garantir que a tabela existe (roda migration mínima)
    await db.query(`
      CREATE TABLE IF NOT EXISTS produtos (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        nome              VARCHAR(100) NOT NULL,
        emoji             VARCHAR(10)  DEFAULT '🍺',
        preco             DECIMAL(10,2) NOT NULL DEFAULT 0,
        custo             DECIMAL(10,2) NOT NULL DEFAULT 0,
        estoque           INT          NOT NULL DEFAULT 0,
        estoque_minimo    INT          NOT NULL DEFAULT 5,
        evento_id         INT          NOT NULL DEFAULT 1,
        categoria         VARCHAR(50)  NOT NULL DEFAULT '',
        combo_qtd         INT          DEFAULT NULL,
        combo_preco       DECIMAL(10,2) DEFAULT NULL,
        dose_ml           INT          DEFAULT NULL,
        garrafa_ml        INT          DEFAULT NULL,
        garrafa_preco     DECIMAL(10,2) DEFAULT NULL,
        unidades_por_fardo INT         DEFAULT NULL,
        criado_em         TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Limpar os produtos locais do evento 1
    await db.query('DELETE FROM produtos WHERE evento_id = 1');

    // Inserir todos os produtos do Railway
    for (const p of produtos) {
      await db.query(
        `INSERT INTO produtos
           (nome, emoji, preco, custo, estoque, estoque_minimo, evento_id,
            categoria, combo_qtd, combo_preco, dose_ml, garrafa_ml, garrafa_preco, unidades_por_fardo)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.nome,
          p.emoji             || '🍺',
          p.preco             || 0,
          p.custo             || 0,
          p.estoque           || 0,
          p.estoque_minimo    || 5,
          p.categoria         || '',
          p.combo_qtd         ?? null,
          p.combo_preco       ?? null,
          p.dose_ml           ?? null,
          p.garrafa_ml        ?? null,
          p.garrafa_preco     ?? null,
          p.unidades_por_fardo ?? null,
        ]
      );
    }

    console.log('OK ✅');
  } catch (e) {
    console.error('\n❌  Erro ao importar:', e.message);
    await db.end();
    process.exit(1);
  }

  await db.end();

  console.log(`
✅  ${produtos.length} produto${produtos.length !== 1 ? 's' : ''} importado${produtos.length !== 1 ? 's' : ''} com sucesso!

🎉  Banco local está sincronizado com o Railway.
    Para iniciar o app local: ./iniciar.sh
    Acesse em:                http://localhost:3000
`);
}

main().catch(err => {
  console.error('\n❌  Erro inesperado:', err.message);
  process.exit(1);
});
