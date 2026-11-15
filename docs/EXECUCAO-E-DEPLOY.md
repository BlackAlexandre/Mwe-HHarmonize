# Execução, migração e publicação

## Local
`npm install` → copiar `.env.example` para `.env` (definir ADMIN_EMAIL/ADMIN_PASSWORD) → `npm run dev` (http://localhost:3000). Testes: `npm test`. Build: `npm run build`.

## Migração do banco (automática e aditiva)
Na inicialização o servidor acrescenta à tabela `events` as colunas `end_time, attire, crew_arrival, venue_contact, critical_notes, contract_value` e cria as tabelas `repertoire` e `finances`, com índices próprios. Os lançamentos financeiros podem apontar para um evento; ao excluir um evento, os lançamentos vinculados são mantidos e ficam sem vínculo. Lançamentos vencidos passam de `pendente` para `atrasado` na inicialização. A migração não substitui o banco nem remove tabelas. Faça cópia do `harmonize.db` antes de publicar.

## Publicação (pendente de decisão)
O banco é um arquivo SQLite local (`DB_FILE`). Em hospedagem serverless o disco não é persistente: use um servidor com volume persistente (VPS, Fly.io/Railway com volume) ou migre para um banco gerenciado (ex.: Postgres), o que exige trocar a camada `node:sqlite` em `server.ts`. Em produção defina `NODE_ENV=production`, `APP_URL` HTTPS, `BREVO_API_KEY` e `EMAIL_FROM`.

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
- `security_audit` registra identificador de usuário, ação, tipo/id do recurso e horário. Não registra senha, token, e-mail, telefone nem payload. Não existe painel/API de auditoria nem política automática de retenção; acesso ao arquivo SQLite deve permanecer restrito ao processo/administradores do servidor.

### Limite de autorização e multiusuário

O schema atual não possui organização/conta, papel, status de usuário ou associação de proprietário para clientes, eventos, equipe e lançamentos financeiros. A única criação prevista é o usuário inicial por ambiente; não há API ou tela de colaboradores/RBAC. Assim, qualquer sessão autenticada acessa os mesmos registros globais desses módulos. Isso é um bloqueador para uso multiempresa ou para dados que devam ser isolados por usuário. Antes de criar usuários/colaboradores, é necessário definir o modelo de organização e migrar os registros existentes para um proprietário/conta, com autorização em todas as rotas. Esta auditoria não inventa essa associação nem altera a semântica dos dados existentes.

### Privacidade e LGPD

O sistema trata dados de conta (nome/e-mail), clientes (nome, e-mail, telefone, observações), dados de eventos/contatos, registros financeiros e dados de equipe (nome, função, telefone). Preferências de acessibilidade ficam no `localStorage` do navegador. Não foi identificada política de retenção, exportação do titular, exclusão/anonimização de dados pessoais ou processo operacional para atender solicitações LGPD. Defina finalidade, base legal, retenção e responsável antes de operar com dados reais; preserve registros financeiros/auditoria quando houver obrigação aplicável. Nenhum dado pessoal deve ser copiado para logs de aplicação.
