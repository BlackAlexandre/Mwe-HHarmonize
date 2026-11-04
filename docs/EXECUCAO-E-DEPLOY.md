# Execução, migração e publicação

## Local
`npm install` → copiar `.env.example` para `.env` (definir ADMIN_EMAIL/ADMIN_PASSWORD) → `npm run dev` (http://localhost:3000). Testes: `npm test`. Build: `npm run build`.

## Migração do banco (automática e aditiva)
Na inicialização o servidor só **acrescenta** à tabela `events` as colunas `end_time, attire, crew_arrival, venue_contact, critical_notes, contract_value` e cria a tabela `repertoire` (FK com exclusão em cascata). Nenhum registro é alterado ou apagado; os status existentes continuam válidos e `preparacao` (Em preparação) é um valor novo. Reversão: as colunas novas podem ser ignoradas pela versão anterior; faça cópia do `harmonize.db` antes de publicar.

## Publicação (pendente de decisão)
O banco é um arquivo SQLite local (`DB_FILE`). Em hospedagem serverless o disco não é persistente: use um servidor com volume persistente (VPS, Fly.io/Railway com volume) ou migre para um banco gerenciado (ex.: Postgres), o que exige trocar a camada `node:sqlite` em `server.ts`. Em produção defina `NODE_ENV=production`, `APP_URL` e as variáveis `SMTP_*` (recuperação de senha).
