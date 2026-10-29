# MWE Harmonize — eventos, agenda, clientes e autenticação

Stack: Node 22+, Express, SQLite (`node:sqlite`), TypeScript (tsx) e front-end SPA em JS puro.

## Executar
```
npm install
cp .env.example .env   # defina ADMIN_EMAIL e ADMIN_PASSWORD
npm run dev            # http://localhost:3000
npm run build          # typecheck + checagem do JS
npm test               # testes de API (sobem o servidor com banco temporário)
```
O banco (`harmonize.db`) e as tabelas são criados na primeira execução. O usuário inicial vem de `ADMIN_EMAIL`/`ADMIN_PASSWORD`.

## Segurança
Senhas com scrypt + salt; sessões com token aleatório (só o hash SHA-256 fica no banco), cookie HttpOnly/SameSite=Lax (Secure em produção); "permanecer conectado" = 30 dias, senão 12 h; limite de tentativas de login; rotas `/api/events` e `/api/clients` protegidas.

## Recuperação de acesso (pendência externa)
O link de redefinição (válido por 1 h, uso único) é gerado e escrito no log do servidor. Em desenvolvimento a API também o devolve na tela. Para enviar por e-mail em produção falta integrar um SMTP/serviço (ex.: SMTP_HOST, SMTP_USER, SMTP_PASS) no ponto marcado com `TODO` em `server.ts`.

## Fora do escopo
Financeiro, equipe, repertório e relatórios aparecem no menu como "em breve".
