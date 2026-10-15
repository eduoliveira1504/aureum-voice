# Aureum Voice — Fase 1 (núcleo)

App de comunicação estilo Discord para grupo pequeno (~10 pessoas).
Prioridade máxima: voz, câmera e compartilhamento de tela COM áudio do sistema.
Projeto também é portfólio: README, commits e docs em inglês; commits pequenos e descritivos.

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

## Ambiente
- Dev no Windows com Docker Desktop (WSL2). Tudo roda local até a tarefa 9.
- LiveKit em dev: modo --dev, range de portas UDP pequeno (ex: 50000-50100) para o Docker
  no Windows não pesar; node_ip configurável via .env.
- Antes de cada tarefa, explique em poucas linhas o que vai fazer e por quê.

## Stack
- Desktop: Electron + React + TypeScript (template electron-vite), Tailwind
- Mídia: LiveKit (self-hosted) + livekit-client / @livekit/components-react
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
  docs/decisions/      # registros curtos de decisões de arquitetura
  .env.example
  README.md

## Modelo de dados
- users: id, username (único), display_name, email (único), password_hash,
  avatar_url, banner_url, bio, accent_color, created_at
- oauth_accounts: id, user_id, provider, provider_user_id, unique(provider, provider_user_id)  [futuro]
- servers: id, name, icon_url, owner_id, created_at
- server_members: server_id, user_id, role (owner|admin|member), joined_at
- invites: code, server_id, created_by, expires_at, max_uses, uses
- channels: id, server_id (NULLABLE — fase 2 usa para DM/grupo), name, type (text|voice|dm|group_dm), position
- messages: id, channel_id, author_id, content, attachments (jsonb), created_at, edited_at
Avatar e banner aceitam PNG/JPG/GIF/WebP animado (máx 8MB), salvos no MinIO.

## API (REST, prefixo /api)
Auth: POST /auth/register, POST /auth/login, POST /auth/refresh
Users: GET /users/me, PATCH /users/me, POST /users/me/avatar, POST /users/me/banner, GET /users/{id}
Servers: POST /servers, GET /servers (meus), GET /servers/{id}, PATCH /servers/{id}, DELETE /servers/{id}
Invites: POST /servers/{id}/invites, POST /invites/{code}/join
Channels: POST /servers/{id}/channels, PATCH /channels/{id}, DELETE /channels/{id}
Messages: GET /channels/{id}/messages?before=&limit=50, POST /channels/{id}/messages,
          PATCH /messages/{id}, DELETE /messages/{id}
Voz: POST /channels/{id}/voice/token -> token LiveKit (room = id do canal, identity = user id)

## WebSocket (/ws?token=...)
Eventos servidor->cliente: message.created|updated|deleted, presence.updated,
voice.state (quem está em qual canal, mute, câmera, tela), channel.*, server.member.*
Redis pub/sub para distribuir eventos.

## Desktop
- Layout estilo Discord: barra de servidores | lista de canais | conteúdo | membros
- Canal de voz: grid de vídeo, indicador de quem está falando, botões mic / câmera / tela / sair
- Screenshare: desktopCapturer + session.setDisplayMediaRequestHandler com seletor próprio
  de tela/janela; áudio do sistema via audio: 'loopback' (Windows)
- Seleção de microfone/câmera/saída em Configurações; supressão de ruído ligada
- URL da API configurável (local agora, domínio da VM depois)
- Instalador Windows com electron-builder

## Ordem das tarefas
1. infra: docker-compose com postgres, redis, livekit, minio; .env.example; .gitignore completo
2. api: esqueleto FastAPI, models, Alembic, auth e-mail+senha, /users/me
3. desktop: shell Electron+React, telas de login/registro, armazenamento seguro de tokens
4. servidores, canais, convites, mensagens + WebSocket
5. canal de voz: LiveKit com áudio e câmera
6. screenshare com áudio do sistema
7. perfil: upload de avatar/banner (animados), bio, cor
8. README em inglês com arquitetura e instruções de execução
9. deploy na VM Oracle (Caddy com HTTPS via DuckDNS, portas do LiveKit, iptables) + instalador para a galera

## Pronto quando
3 pessoas em PCs diferentes, cada uma na sua internet, entram no mesmo canal de voz,
se falam, ligam câmera e uma compartilha tela com som de jogo.

## Fases seguintes (não implementar agora, mas não bloquear)
2: DM, grupo DM, chamada privada com toque | 3: overlay de câmeras em jogo
4: addons (mapa Minecraft via BlueMap) | 5: música ("ouvir junto" Spotify / bot)
| futuro: login com Google e Discord