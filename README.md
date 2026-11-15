# MWE Harmonize

Sistema web de gerenciamento de eventos, clientes e agenda do **MWE Harmonize**.

## Tecnologias

- Node.js
- TypeScript
- Express
- SQLite
- HTML, CSS e JavaScript
- Brevo API para envio de e-mails
- Playwright para testes de interface

## 1. Pré-requisitos

Instale:

- **Node.js 24.x ou superior**
- **npm**

Verifique:

```powershell
node -v
npm -v
```

## 2. Baixar o projeto

```powershell
git clone https://github.com/BlackAlexandre/Mwe-HHarmonize.git
cd Mwe-HHarmonize
git checkout online-wesley
```

## 3. Instalar dependências

```powershell
npm install
```

## 4. Configurar o `.env`

Crie um arquivo `.env` na raiz do projeto. Use o `.env.example` como referência.

Exemplo:

```env
PORT=3000
DB_FILE=harmonize.db
APP_URL=http://localhost:3000

ADMIN_EMAIL=seu-email@exemplo.com
ADMIN_PASSWORD=coloque-uma-senha-forte-aqui
ADMIN_NAME=Administrador

NODE_ENV=development

BREVO_API_KEY=sua-chave-do-brevo
EMAIL_FROM="MWE Harmonize <seu-email@exemplo.com>"
```

**Importante:** nunca publique o `.env` no GitHub. O projeto já possui o `.env` no `.gitignore`.

Não coloque senhas, chaves da Brevo ou outras credenciais diretamente no código.

## 5. Banco de dados

O sistema utiliza **SQLite**.

Por padrão, o banco é criado automaticamente como:

```text
harmonize.db
```

O banco é local à máquina/servidor que executa a aplicação. O arquivo não deve ser enviado ao GitHub.

## 6. Executar o projeto

Depois de instalar as dependências e configurar o `.env`:

```powershell
npm run dev
```

Acesse:

```text
http://localhost:3000
```

Para parar o servidor:

```text
Ctrl + C
```

## 7. Login inicial

O usuário administrador inicial é criado a partir de:

```env
ADMIN_EMAIL=
ADMIN_PASSWORD=
ADMIN_NAME=
```

Use os valores configurados no `.env` para entrar no sistema.

**Não compartilhe essas credenciais.**

## 8. Recuperação de senha e envio de e-mails

O sistema utiliza a **API da Brevo**.

Configure:

```env
BREVO_API_KEY=sua-chave
EMAIL_FROM="MWE Harmonize <email-verificado@exemplo.com>"
APP_URL=http://localhost:3000
```

Em produção, utilize a URL HTTPS do sistema.

O endereço utilizado em `EMAIL_FROM` precisa estar autorizado/verificado na Brevo.

## 9. Funcionalidades principais

### Eventos

- Cadastro de eventos
- Consulta de eventos
- Edição de eventos
- Exclusão de eventos
- Dados gerais
- Cliente
- Local
- Data e horário
- Status
- Detalhes do evento
- Busca e filtros
- Duplicidade de eventos

### Agenda

- Visualização mensal
- Visualização semanal
- Visualização em lista
- Busca e filtros
- Identificação de conflitos
- Criação de eventos pela agenda
- Visualização de detalhes

### Clientes

- Cadastro
- Consulta
- Edição
- Exclusão
- Busca
- Validações

### Acesso

- Login
- Autenticação
- Manter conectado
- Logout
- Recuperação de acesso
- Alteração de senha

### Conta

- Alteração de nome
- Alteração de e-mail
- Alteração de senha

### Outros módulos

O projeto também possui módulos integrados de:

- Equipe
- Repertório
- Financeiro
- Relatórios
- Acessibilidade
- Configurações

## 10. Executar os testes

```powershell
npm test
```

Para executar o build:

```powershell
npm run build
```

## 11. Estrutura principal

```text
Mwe-HHarmonize/
│
├── public/
│   ├── app.js
│   ├── index.html
│   ├── style.css
│   ├── logo.jpg
│   └── icons/
│
├── tests/
│   ├── api.test.ts
│   ├── email-config.test.ts
│   ├── mock-brevo.ts
│   ├── persistence.test.ts
│   └── ui.test.ts
│
├── docs/
│   └── EXECUCAO-E-DEPLOY.md
│
├── email-service.ts
├── server.ts
├── package.json
├── package-lock.json
├── tsconfig.json
├── .env.example
└── .gitignore
```

## 12. Desenvolvimento

```powershell
npm run dev
```

Depois acesse:

```text
http://localhost:3000
```

## 13. Deploy

O projeto pode ser executado em serviços de hospedagem como o Render.

Configure as variáveis de ambiente diretamente no serviço:

```text
PORT
DB_FILE
APP_URL
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_NAME
NODE_ENV
BREVO_API_KEY
EMAIL_FROM
```

Não envie o `.env` para o GitHub.

### Atenção ao SQLite

O SQLite é um arquivo local. Em hospedagem, é necessário utilizar armazenamento persistente para garantir que os dados não sejam perdidos quando a aplicação for reiniciada ou recriada.

## 14. Segurança

O projeto utiliza, entre outras medidas:

- Senhas armazenadas com hash
- Tokens de recuperação armazenados com hash
- Tokens com expiração
- Tokens de recuperação de uso único
- Respostas de recuperação que evitam exposição de existência de contas
- Proteção de rotas privadas
- Variáveis sensíveis no `.env`
- `.env` ignorado pelo Git
- API de e-mail via HTTPS
- Validação de dados
- Proteção contra envio de credenciais para o repositório

**Nunca publique:**

```text
.env
BREVO_API_KEY
ADMIN_PASSWORD
banco de dados
tokens de recuperação
outras credenciais
```

## 15. Problemas comuns

### `npm` não é reconhecido

Verifique:

```powershell
node -v
npm -v
```

Se não funcionarem, reinstale o Node.js e reinicie o PowerShell.

### Porta 3000 ocupada

Se aparecer:

```text
EADDRINUSE: address already in use :::3000
```

significa que outro processo está usando a porta.

Você pode alterar a porta no `.env`:

```env
PORT=3001
```

E acessar:

```text
http://localhost:3001
```

### E-mail não é enviado

Confira:

```env
BREVO_API_KEY=
EMAIL_FROM=
APP_URL=
```

Também confirme se o endereço configurado em `EMAIL_FROM` está verificado na Brevo.

## 16. Fluxo rápido

```powershell
git clone https://github.com/BlackAlexandre/Mwe-HHarmonize.git
cd Mwe-HHarmonize
git checkout online-wesley
npm install
```

Crie e configure o `.env` e execute:

```powershell
npm run dev
```

Acesse:

```text
http://localhost:3000
```

## Licença

Projeto desenvolvido para o MWE Harmonize.
