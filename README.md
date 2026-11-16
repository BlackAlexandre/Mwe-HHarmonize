# MWE Harmonize

AplicaÃƒÂ§ÃƒÂ£o web MWE Harmonize com API Express/TypeScript e PostgreSQL central como banco principal.

## Desenvolvimento local

1. Instale Node.js compatÃƒÂ­vel com o projeto e execute `npm install`.
2. Crie um banco PostgreSQL (versÃƒÂ£o 15 ou superior) e copie `.env.example` para `.env`.
3. Preencha `DATABASE_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (mÃƒÂ­nimo 12 caracteres) e `ADMIN_NAME`. Use credenciais somente no `.env` local ou em variÃƒÂ¡veis secretas do provedor.
4. Inicie com `npm run dev`. O servidor cria aditivamente tabelas e ÃƒÂ­ndices ao iniciar.

`DATABASE_URL` tem o formato `postgresql://usuario:senha@host:5432/banco`. NÃƒÂ£o use o banco de produÃƒÂ§ÃƒÂ£o em testes.

## Render

Crie um PostgreSQL gerenciado no Render e adicione sua URL interna como `DATABASE_URL` nas variÃƒÂ¡veis do serviÃƒÂ§o web. Configure tambÃƒÂ©m `NODE_ENV=production`, `APP_URL` HTTPS, `BREVO_API_KEY`, `EMAIL_FROM` e credenciais seguras de bootstrap (`ADMIN_EMAIL` e `ADMIN_PASSWORD` quando o PostgreSQL estiver vazio). O comando de inicializaÃƒÂ§ÃƒÂ£o existente ÃƒÂ© `npm start`; os dados persistem no PostgreSQL e nÃƒÂ£o no filesystem da instÃƒÂ¢ncia.

## Migrar o SQLite existente

Pare a aplicaÃƒÂ§ÃƒÂ£o que escreve no arquivo e faÃƒÂ§a checkpoint/feche qualquer WAL. Crie um PostgreSQL vazio, configure `DATABASE_URL` e execute:

```powershell
npm run migrate:postgres -- ./harmonize.db
```

O importador cria backup verificado ao lado do arquivo SQLite, preserva o original e importa os registros numa transaÃƒÂ§ÃƒÂ£o. Ele aborta se o PostgreSQL de destino jÃƒÂ¡ tiver dados ou se encontrar schema/relacionamentos incompatÃƒÂ­veis. Revise as contagens antes de iniciar o app apontado para o novo banco.

## Testes e build

Defina `TEST_DATABASE_URL` para um PostgreSQL dedicado aos testes. EntÃƒÂ£o execute `npm test`, `npm run build` e `git diff --check`. A URL deve apontar para um banco descartÃƒÂ¡vel; os testes podem limpar o schema de teste.

Detalhes de deploy, backups, seguranÃƒÂ§a e migraÃƒÂ§ÃƒÂ£o estÃƒÂ£o em [docs/EXECUCAO-E-DEPLOY.md](docs/EXECUCAO-E-DEPLOY.md).
