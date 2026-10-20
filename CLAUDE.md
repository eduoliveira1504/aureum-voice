# Aureum Voice

> Fase atual: 3 (beta). Spec em docs/decisions/PHASE3.md (um bloco por vez, na ordem).
> Fases 1 e 2 concluídas; PHASE2.md é referência histórica. Onde este arquivo e o
> PHASE3.md divergirem, vale o PHASE3.md.

App de comunicação (voz, câmera, compartilhamento de tela, chat e addons) com identidade
própria. Público do beta: grupos de amigos e pequenos times de trabalho.
Prioridade: voz, câmera e compartilhamento de tela COM áudio do sistema.
Projeto também é portfólio: commits e docs em inglês; commits pequenos e descritivos.
O README é em português (público do beta) com uma seção curta "In English" no fim; o conteúdo
técnico fica em docs/DEVELOPMENT.md. A landing (site/) é toda em português.

## Princípios do produto
- Sem recursos de IA dentro do app (resumos, chatbots, sugestões automáticas etc.).
  O Aureum é simples e direto. Não sugerir nem implementar IA no produto.
- Personalização e identidade são grátis; plano pago só para o que tem custo real
  (qualidade de transmissão, armazenamento).
- Identidade própria: nada copiado do Discord (sons, ícones, textos, layout idêntico).
- Logo oficial: docs/design/brand/logo.svg (32px pra cima) e logo-small.svg (16–24px). São a
  fonte de todos os ícones: `npm run build:icons` (apps/desktop) gera o .ico e os PNGs da bandeja;
  o componente Logo.tsx e a insígnia Fundador repetem o desenho. Trocou o logo, rode de novo.

## Regras de custo (OBRIGATÓRIO)
O projeto deve custar R$0. Nunca execute, sugira como passo padrão ou automatize nada que gere cobrança.
- Oracle Cloud: usar SOMENTE recursos "Always Free" (VM.Standard.A1.Flex até 4 OCPU / 24 GB,
  Ubuntu, região São Paulo). Nunca fazer upgrade para Pay As You Go. Nunca instalar ou usar
  a OCI CLI/SDK nem criar recursos na nuvem por linha de comando; mudanças no console são
  feitas pelo Eduardo, manualmente.
- Não criar contas, assinaturas, planos ou chaves de API pagas em nenhum serviço.
- Preferir sempre soluções self-hosted e open source.
- Se alguma tarefa exigir serviço pago ou que possa virar pago, PARE e pergunte antes,
  explicando o custo e a alternativa grátis.
- Nunca colocar segredos no código ou no git; apenas no .env (que está no .gitignore).
- EXCEÇÕES AUTORIZADAS pelo Eduardo (plano B, enquanto não há VM Oracle): LiveKit Cloud
  no plano GRÁTIS e Tailscale Funnel no plano GRÁTIS. Nunca fazer upgrade de plano em
  nenhum deles; se algo exigir plano pago, PARE e pergunte.
- EXCEÇÃO AUTORIZADA permanente: envio de e-mail por SMTP de uma conta Gmail dedicada do
  Aureum (grátis, limite ~500/dia). Credenciais só no .env.
  

## Ambiente
- Dev no Windows com Docker Desktop (WSL2).
- Comandos do Docker sempre a partir da raiz do projeto e com o .env:
  docker compose --env-file .env -f infra/docker-compose.yml <comando>
- LiveKit local (perfil opcional "local-livekit"): modo --dev, range de portas UDP pequeno
  (ex: 50000-50100) para o Docker no Windows não pesar; node_ip configurável via .env.
- Testes usam banco separado do banco de desenvolvimento.
- Testes da API (em todo bloco): `node scripts/test-api.mjs [args do pytest]`, que roda o pytest num
  contêiner temporário na rede do compose (banco aureum_test), sem mexer nos contêineres que estão
  rodando; funciona com o stack em dev ou no plano B.
- Desktop: `npm run typecheck` e `npm test` (Vitest) em apps/desktop.
- Antes de cada tarefa, explique em poucas linhas o que vai fazer e por quê.

## Stack
- Desktop: Electron + React + TypeScript (template electron-vite), Tailwind
- Mídia: LiveKit + livekit-client / @livekit/components-react
- API: Python 3.12, FastAPI, SQLAlchemy 2 + Alembic, Pydantic v2
- Banco: Postgres 16 | Cache/pubsub/presença: Redis
- Arquivos: MinIO (S3-compatível) para avatar, banner e anexos
- Auth: e-mail+senha (argon2); JWT access (15min) + refresh (30 dias).
  OAuth Google/Discord fica para depois, mas manter a tabela oauth_accounts no modelo.
- Infra: docker-compose para tudo exceto o app desktop

## Estrutura (monorepo)
aureum-voice/
  apps/desktop/        # Electron + React
  apps/api/            # FastAPI
  infra/docker-compose.yml
  infra/livekit.yaml
  scripts/             # utilitários (ex: generate-sounds.mjs)
  site/                # landing page (GitHub Pages, HTML/CSS/JS sem build)
  docs/decisions/      # decisões de arquitetura + PHASE2.md
  docs/DEVELOPMENT.md  # conteúdo técnico (arquitetura, rodar local, testes, hospedagem)
  docs/sounds/         # licenças dos sons
  .env.example
  README.md

## Modelo de dados
(Modelo original da Fase 1. A Fase 2 adicionou cargos, permissões por canal, amizades,
DMs, chamadas, read-state, user_settings, perfil estendido etc.; consultar as migrações
para o estado atual.)
- users: id, username (único), display_name, email (único), password_hash,
  avatar_url, banner_url, bio, accent_color, created_at
- oauth_accounts: id, user_id, provider, provider_user_id, unique(provider, provider_user_id)  [futuro]
- servers: id, name, icon_url, owner_id, created_at
- server_members: server_id, user_id, joined_at
- invites: code, server_id, created_by, expires_at, max_uses, uses
- channels: id, server_id (NULL em DM/grupo), name, type (text|voice|dm|group_dm|addon), position
- messages: id, channel_id, author_id, content, attachments (jsonb), created_at, edited_at
Avatar e banner aceitam PNG/JPG/GIF/WebP animado (máx 8MB), salvos no MinIO.

## API (REST, prefixo /api) — base da Fase 1
Auth: POST /auth/register, POST /auth/login, POST /auth/refresh
Users: GET /users/me, PATCH /users/me, POST /users/me/avatar, POST /users/me/banner, GET /users/{id}
Servers: POST /servers, GET /servers (meus), GET /servers/{id}, PATCH /servers/{id}, DELETE /servers/{id}
Invites: POST /servers/{id}/invites, POST /invites/{code}/join
Channels: POST /servers/{id}/channels, PATCH /channels/{id}, DELETE /channels/{id}
Messages: GET /channels/{id}/messages?before=&limit=50, POST /channels/{id}/messages,
          PATCH /messages/{id}, DELETE /messages/{id}
Voz: POST /channels/{id}/voice/token -> token LiveKit (room = id do canal, identity = user id)
Todas as rotas checam permissão no servidor (nunca só no front).

## WebSocket (/ws?token=...)
Eventos servidor->cliente: message.created|updated|deleted, presence.updated,
voice.state (quem está em qual canal, mute, câmera, tela), channel.*, server.member.*,
call.* (chamadas privadas), read-state. Redis pub/sub para distribuir eventos.

## Desktop
- Layout próprio do Aureum (definido no bloco 2.L do PHASE2.md): abas no topo (Início +
  servidores), barra lateral do contexto, Visão geral com salas ao vivo, painéis lado a
  lado e janelinha da call. NÃO usar a estrutura do Discord (coluna de servidores +
  canais + chat + membros fixa).
- Design system: tokens do bloco 2.1 (tema claro/escuro, accent personalizável,
  Sora + Figtree). Nenhuma cor hardcoded.
- Screenshare: desktopCapturer + session.setDisplayMediaRequestHandler com seletor próprio
  de tela/janela; áudio do sistema via audio: 'loopback' (Windows)
- Seleção de microfone/câmera/saída em Configurações; supressão de ruído (RNNoise) ligada
- URL da API configurável (local agora, domínio da VM depois)
- Instalador Windows com electron-builder

## Fase 1 (concluída)
1. infra: docker-compose com postgres, redis, livekit, minio ✅
2. api: FastAPI, models, Alembic, auth e-mail+senha ✅
3. desktop: shell Electron+React, login/registro ✅
4. servidores, canais, convites, mensagens + WebSocket ✅
5. canal de voz: LiveKit com áudio e câmera ✅
6. screenshare com áudio do sistema ✅
7. perfil: avatar/banner animados, bio, cor ✅
8. README em inglês ✅
9. deploy na VM Oracle — PENDENTE (sem capacidade na Oracle; rodando no plano B)

## Deploy provisório (plano B)
Enquanto não há VM Oracle (out of capacity). A tarefa 9 (VM Oracle) continua sendo o destino final;
o plano B é temporário e não deve criar dependências que impeçam a migração.
- Mídia (voz, câmera, tela): LiveKit Cloud, plano grátis (Build). Credenciais só no .env
  (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET); nunca imprimir, logar ou commitar.
  Cota grátis é teto rígido (≈5.000 min de participante e 50 GB de download/mês): ao acabar,
  as conexões falham até o mês seguinte, sem cobrança.
- API, WebSocket, Postgres, Redis e MinIO: no PC do Eduardo via docker-compose.
  Postgres, Redis e MinIO sem portas publicadas no host; a API só em 127.0.0.1.
  O LiveKit local fica no perfil opcional "local-livekit" (dev 100% local).
- Acesso público: Tailscale Funnel na 443 (*.ts.net) expondo SOMENTE a API + WebSocket.
  Imagens (avatar/banner/anexos) saem pela API em /api/media; o MinIO nunca é exposto.
- Segurança antes de expor: cadastro só com código de convite, rate limit em login/registro,
  CORS e origem do WebSocket restritos ao app.
- Amigos só instalam o app (instalador Windows apontando para o endereço do Funnel).

## Próximos passos
Seguir os blocos do docs/decisions/PHASE2.md. Depois da Fase 2: migração para a VM Oracle
(tarefa 9), login com Google/Discord, importação de servidores do Discord (estrutura
primeiro), eventos, wiki do servidor, plano Aureum+.

## Beta fechado
- Enquanto AUREUM_INVITE_ONLY=true, cadastro só com código de convite. AUREUM_BETA controla a
  insígnia Pioneiro; AUREUM_INVITE_ONLY controla o cadastro. São chaves independentes.
- A única página web pública é a de convite (/convite/{codigo}), servida pela API via Funnel:
  só cadastro + confirmação de e-mail + link de download. Nada de login web, chat web ou
  outras funções no navegador sem eu pedir.
- Toda rota pública de cadastro/verificação tem rate limit por IP.
- Contas oficiais (flag --oficial) nunca recebem Pioneiro nem convites. Essa exceção é SÓ
  pela flag, nunca pela forma de criação da conta.
- Senhas temporárias geradas pela CLI aparecem uma única vez no terminal e nunca vão pra log.