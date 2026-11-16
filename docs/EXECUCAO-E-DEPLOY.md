# Execução, migração e publicação

## Local
`npm install` → criar um PostgreSQL local → copiar `.env.example` para `.env` e preencher `DATABASE_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` → `npm run dev` (http://localhost:3000). Testes PostgreSQL: definir `TEST_DATABASE_URL` para um banco de teste dedicado e executar `npm test`. Build: `npm run build`.

## Migração do banco (automática e aditiva)
Na inicialização, o PostgreSQL recebe as tabelas e índices necessários com `CREATE TABLE/INDEX IF NOT EXISTS`; os dados existentes nunca são descartados. O banco precisa ser PostgreSQL 15 ou superior (usado pelo vínculo opcional de finanças com evento). Lançamentos vencidos passam de `pendente` para `atrasado` na inicialização.

## Publicação (pendente de decisão)
Configure um PostgreSQL gerenciado no Render e informe a URL de conexão interna como variável `DATABASE_URL` no serviço web. Use a URL interna quando o banco e o serviço estiverem na mesma região; não salve URLs com credenciais no repositório, não imprima o valor em logs e não use `DB_FILE` como persistência. Defina também `NODE_ENV=production`, `APP_URL` HTTPS, `BREVO_API_KEY` e `EMAIL_FROM`. O pool usa `PG_POOL_MAX` (padrão 10); dimensione o total de conexões considerando número de instâncias e limite do plano PostgreSQL.

### Migração única do SQLite existente

1. Pare todas as instâncias que escrevem no SQLite. Se existir `harmonize.db-wal`, faça checkpoint pelo SQLite e aguarde o encerramento correto do servidor; o script aborta se encontrar WAL ativo.
2. Crie um PostgreSQL de destino vazio (sem rodar a aplicação com `ADMIN_EMAIL` antes da importação).
3. Configure `DATABASE_URL` localmente, sem compartilhá-la, e execute `npm run migrate:postgres -- ./harmonize.db` (ou indique o caminho do arquivo como argumento). O script cria e valida uma cópia de backup, verifica integridade e foreign keys, importa tabelas em ordem, atualiza sequences e confirma tudo numa transação. O SQLite original não é removido.
4. Confira as contagens apresentadas pelo script e faça backup do PostgreSQL. Só então configure a mesma `DATABASE_URL` no Render e inicie a aplicação.

O importador reconhece usuários, organizações, permissões, sessões, recuperação, auditoria, clientes, eventos, equipe, repertório, financeiro, configurações, convites e tabelas legadas de pagamentos/equipe. Ele exige `organization_id` nos dados de módulos com isolamento e para diante de inconsistências, esquema desconhecido ou destino com dados; não descarta colunas em silêncio. Revise colunas novas manualmente se a tabela SQLite tiver campos fora do schema PostgreSQL.

### Backups e diagnóstico

Use backups automáticos do PostgreSQL gerenciado e mantenha uma cópia exportada fora da instância do app. Para checar conectividade sem imprimir credenciais, rode a aplicação com `DATABASE_URL` configurada e confirme a mensagem de inicialização; erros do driver são encaminhados ao log de processo sem ecoar a URL. O teste de integração precisa de um PostgreSQL separado configurado em `TEST_DATABASE_URL`; nunca aponte os testes para dados de produção.

## E-mail transacional (Brevo HTTPS)
Configure `BREVO_API_KEY`, `EMAIL_FROM` e `APP_URL` somente no ambiente do backend. `EMAIL_FROM` pode ser um endereço simples ou o formato `Nome <email@dominio>`; o remetente precisa estar registrado e verificado na conta Brevo. Em desenvolvimento use `NODE_ENV=development` e `APP_URL=http://localhost:3000`; em produção, use uma origem HTTPS pública. O serviço envia para `POST https://api.brevo.com/v3/smtp/email`, só considera o envio aceito quando recebe resposta HTTP de sucesso e registra erros com dados sanitizados, sem chave, tokens, destinatários ou conteúdo do e-mail. Sem configuração, recuperação e convites retornam mensagem amigável e não criam tokens/convites utilizáveis.

Recuperação usa token aleatório válido por 1 hora; apenas o hash fica no banco e o token é invalidado após uso. Convites expiram em 48 horas e preservam o perfil selecionado. A resposta de recuperação permanece genérica para não revelar se um endereço está cadastrado. Os testes usam um mock local da API da Brevo, sem credenciais reais.

## Testes
`npm test` roda: API (auth, eventos, clientes, conta, Brevo simulado, financeiro e relatórios), persistência após reinício do servidor e interface (jsdom executando o `app.js` contra o servidor: login, agenda mensal/semanal/lista, cadastro em 4 etapas, filtros, conflitos, detalhes, clientes, financeiro, relatórios, celular e logout). jsdom não renderiza layout nem CSS: a fidelidade visual ao Figma e o comportamento em navegador real ainda precisam de conferência manual.

## Auditoria de segurança (estado atual)

- Senhas são armazenadas com `scrypt` e salt aleatório; não existe API que retorne hashes. Cadastro inicial usa `ADMIN_EMAIL`/`ADMIN_PASSWORD` somente quando a tabela de usuários está vazia. Não configure credenciais padrão em produção.
- Sessões usam token aleatório no cookie `HttpOnly; SameSite=Lax`; o banco guarda somente SHA-256 do token. A sessão dura 12 horas, ou 30 dias quando `remember=true`; em produção o cookie recebe `Secure`. Sessões expiradas são limpas na autenticação e na inicialização. Logout e mudança/recuperação de senha invalidam sessões conforme o fluxo.
- Recuperação guarda hash de token de uso único com validade de uma hora, invalida tokens anteriores e responde sem confirmar se o e-mail existe. Sem configuração da Brevo, o fluxo informa indisponibilidade e não cria token. Links de redefinição não são escritos nos logs.
- Requisições de escrita com `Origin` são comparadas à origem pública `APP_URL`. Clientes sem `Origin` continuam aceitos por compatibilidade com chamadas servidor a servidor; o cookie `SameSite=Lax` continua aplicado. CORS não é habilitado.
- Limites por processo: login até 20 tentativas por IP e 10 por combinação IP/conta em 15 minutos (evita bloqueio global da conta); recuperação até 5 por IP e redefinição até 10 por IP. O contador é em memória e não coordena múltiplas instâncias; produção horizontal deve usar um limitador compartilhado (por exemplo Redis) e configurar proxy confiável com cuidado.
- Headers incluem `nosniff`, `DENY`, `Referrer-Policy` e política restritiva de recursos do dispositivo; HSTS é enviado quando `NODE_ENV=production`. CSP não foi ativado porque o frontend existente usa handlers inline e recursos externos; essa migração precisa ser feita separadamente para evitar quebrar a interface.
- `security_audit` registra identificador de usuário, ação, tipo/id do recurso e horário. Não registra senha, token, e-mail, telefone nem payload. Não existe painel/API de auditoria nem política automática de retenção; proteja acesso e backups do PostgreSQL.

### Autorização e isolamento multiempresa

Usuários ativos pertencem a uma organização por meio de `organization_members`; funções e permissões granulares são armazenadas em `role_permissions` e `member_permissions`. Rotas privadas validam sessão e permissões, e as consultas de clientes, eventos, equipe, financeiro, repertório, configurações e relatórios são limitadas ao `organization_id` da sessão. Convites preservam o perfil e a ativação cria a associação organizacional. Mudanças de perfil, status, permissões ou e-mail revogam sessões do usuário afetado.

### Privacidade e LGPD

O sistema trata dados de conta (nome/e-mail), clientes (nome, e-mail, telefone, observações), dados de eventos/contatos, registros financeiros e dados de equipe (nome, função, telefone). Preferências de acessibilidade ficam no `localStorage` do navegador. Não foi identificada política de retenção, exportação do titular, exclusão/anonimização de dados pessoais ou processo operacional para atender solicitações LGPD. Defina finalidade, base legal, retenção e responsável antes de operar com dados reais; preserve registros financeiros/auditoria quando houver obrigação aplicável. Nenhum dado pessoal deve ser copiado para logs de aplicação.
