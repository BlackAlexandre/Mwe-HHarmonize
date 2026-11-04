# Execução, migração e publicação

## Local
`npm install` → copiar `.env.example` para `.env` (definir ADMIN_EMAIL/ADMIN_PASSWORD) → `npm run dev` (http://localhost:3000). Testes: `npm test`. Build: `npm run build`.

## Migração do banco (automática e aditiva)
Na inicialização o servidor só **acrescenta** à tabela `events` as colunas `end_time, attire, crew_arrival, venue_contact, critical_notes, contract_value` e cria a tabela `repertoire` (FK com exclusão em cascata). Nenhum registro é alterado ou apagado; os status existentes continuam válidos e `preparacao` (Em preparação) é um valor novo. Reversão: as colunas novas podem ser ignoradas pela versão anterior; faça cópia do `harmonize.db` antes de publicar.

## Publicação (pendente de decisão)
O banco é um arquivo SQLite local (`DB_FILE`). Em hospedagem serverless o disco não é persistente: use um servidor com volume persistente (VPS, Fly.io/Railway com volume) ou migre para um banco gerenciado (ex.: Postgres), o que exige trocar a camada `node:sqlite` em `server.ts`. Em produção defina `NODE_ENV=production`, `APP_URL` e as variáveis `SMTP_*` (recuperação de senha).

## Recuperação de senha por e-mail (SMTP)
Defina `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` e `APP_URL` (usado no link). O token tem 64 caracteres hex, validade de 1 h e uso único; só o hash fica no banco; a resposta da API é igual para e-mails cadastrados e não cadastrados. Sem `SMTP_HOST` nenhum e-mail é enviado (o log avisa). Para desenvolvimento, `DEV_LOG_RESET_LINKS=true` escreve o link no log do servidor (ignorado em produção). Os testes usam um servidor SMTP falso local, sem credenciais reais. **Falta validar com o servidor SMTP real da equipe.**

## Testes
`npm test` roda: API (auth, eventos, clientes, conta, SMTP simulado), persistência após reinício do servidor e interface (jsdom executando o `app.js` contra o servidor: login, agenda mensal/semanal/lista, cadastro em 4 etapas, filtros, conflitos, detalhes, clientes, celular e logout). jsdom não renderiza layout nem CSS: a fidelidade visual ao Figma e o comportamento em navegador real ainda precisam de conferência manual.
