# Aureum Voice — Fase 3

Base: Fase 2 concluída. Beta fechado no ar desde 19/10/2026 (0.2.0-beta.2), plano B
(LiveKit Cloud + Tailscale Funnel), com usuários reais.
Regras do CLAUDE.md continuam valendo (custo R$0, segredos só no .env, commits em inglês,
sem IA no produto, nada copiado do Discord, regras de privacidade do teclado/overlay).
Executar UM bloco por vez, na ordem. Dentro do bloco: um item por vez, commit por item,
sem push (push só quando o Eduardo pedir). Plano curto antes de começar. Migrações
Alembic, testes da API, README e docs/decisions quando houver escolha de arquitetura.
O Eduardo decide quando gerar release; uma release pode juntar um ou mais blocos.

Status: blocos com ✅ estão prontos; NÃO refazer. Próximo: 3.4. O 3.1, o 3.2 e o 3.3 têm o código pronto (release 0.2.0-beta.3) e esperam os
testes manuais; as ações da @aureum se ligam pela CLI depois da release.

## Regras de produção (valem para todos os blocos)
- Os dados agora são de gente de verdade. Antes de qualquer migração em produção:
  pg_dump com data no nome, mostrar o comando de restauração e só aplicar depois que o
  Eduardo confirmar que o backup existe.
- Comandos que mexem em produção (CLI, migração, broadcast) são mostrados antes e só
  rodam com OK do Eduardo.
- Mudanças de API que sobem antes do release não podem quebrar o app da versão anterior.

## Ritual de release (vale para todas as releases)
- `npm run release` gera um RASCUNHO no GitHub, no mesmo canal do beta.2 (latest.yml
  padrão; NÃO criar canal "beta" separado). O Eduardo publica com o label "None", não
  "Pre-release".
- Antes do release: confirmar que um app da versão anterior instalado vai encontrar a nova.
- Versão segue 0.2.0-beta.N. CHANGELOG em linguagem simples (vai pra galera do beta).
- Depois de publicar: passos para o Eduardo testar no PC dele, com a versão anterior
  instalada, que o app baixa e instala a nova sozinho.

## 3.0 Processo de release (pendência do PHASE2, fazer antes de tudo) ✅
- No 0.2.0-beta.2 o `npm run release` criou DOIS rascunhos para a mesma tag (uploads em
  paralelo, cada um criou o seu).
- Corrigir o scripts/release-desktop.mjs: criar (ou reaproveitar) o rascunho da tag ANTES
  do upload; o electron-builder só anexa os arquivos nele.
- No fim, o script confere que existe um rascunho só, com os 3 arquivos (.exe, .blockmap,
  latest.yml). Se não, para com erro claro.

## 3.1 Correções do primeiro dia
### Ícone novo do app
- Salvar em docs/design/brand/logo.svg e registrar no CLAUDE.md como logo oficial e fonte
  de todos os ícones:
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="48,8 82.6,28 82.6,68 48,88 13.4,68 13.4,28" fill="none" stroke="#E8B531" stroke-width="8" stroke-linejoin="round"/><path d="M48 26 L66 70 H56 L48 50 L40 70 H30 Z" fill="#E8B531"/></svg>
- docs/design/brand/logo-small.svg para 16–24px: hexágono PREENCHIDO #E8B531 com o "A"
  vazado (transparente), cantos levemente arredondados, sem traço fino. Mostrar as duas
  versões lado a lado antes de seguir.
- scripts/build-icons (npm run build:icons) gera tudo a partir dos dois SVGs: logo-small
  até 24px, logo.svg de 32px pra cima. Dependência nova para rasterizar/.ico: perguntar
  antes; só devDependency, licença MIT ou parecida.
- Gerar: .ico multi-tamanho (16, 24, 32, 48, 64, 128, 256) para exe, instalador e atalho
  (win.icon, nsis installerIcon/uninstallerIcon); ícone da janela e da barra de tarefas;
  Tray em 16 e 32px com o logo-small (testar 100/125/150% e barra clara/escura); trocar o
  "A" no quadrado amarelo da barra de título pelo logo.
- app.setAppUserModelId igual ao appId do electron-builder.
- Insígnia "Fundador": coroa → "A" do logo dentro da moldura mítica (hexágono duplo
  dourado, glow, shine). Versão full e small ("A" maior e traço mais grosso). Mantém nome,
  raridade e descrição. Prints das duas antes de fechar.
- README e CHANGELOG: "Se o ícone antigo continuar aparecendo, reinicie o PC (o Windows
  guarda o ícone em cache)."

### Conta-gotas travando (Configurações › Aparência)
- Durante o arraste, NÃO atualizar estado do React: só setProperty no :root dentro de
  requestAnimationFrame (accent, on-accent e accent escurecido do modo claro).
- Salvar em user_settings só ao soltar (pointerup/change) ou debounce de ~400ms.
- Procurar transition: all e transições globais de cor/sombra; limitar ao necessário.
- Critério: arraste fluido e no máximo 1 requisição por interação.

### Overlay aparecendo no navegador
- Primeiro explicar ao Eduardo como o overlay decide hoje que ele está "em jogo".
- Correção com koffi: ler SOMENTE o nome do executável da janela em primeiro plano
  (GetForegroundWindow → GetWindowThreadProcessId → QueryFullProcessImageNameW). Sem
  título de janela. O nome é usado só localmente: nunca vai pro servidor nem para log.
  Consulta no máximo a cada 1s, só durante call com overlay ligado.
- Exceções (overlay escondido), em arquivo de config fácil de editar: chrome, msedge,
  firefox, vivaldi, opera, opera_gx, brave, explorer, o próprio Aureum, discord, spotify, code.
- Configurações › Overlay: "Ocultar overlay neste app" (lista com opção de remover).
- Testar: Vivaldi maximizado e em tela cheia (sem overlay); LoL sem borda (com overlay).

### Sair da tela cheia na transmissão
- Botão no canto superior direito do tile em tela cheia (lucide Minimize2, tooltip
  "Sair da tela cheia (Esc)"), junto dos controles existentes.
- Aparece ao mexer o mouse, some após 2s parado junto com o cursor.
- Clique: document.exitFullscreen(). Duplo clique no vídeo alterna tela cheia.

## 3.2 Microfone
Caso do beta: headset Havit (chip Realtek) com voz de túnel/abafada SÓ no Aureum
(normal no Discord e no WhatsApp). Tratar como bug nosso.

### Compatibilidade (fazer primeiro)
- Primeiro explicar ao Eduardo como o áudio do microfone chega hoje no RNNoise
  (AudioContext, taxa de amostragem, canais).
- Pedir o microfone com channelCount: 1 e sampleRate ideal 48000.
- Garantir que o RNNoise SEMPRE recebe 48kHz: AudioContext criado com sampleRate 48000
  e reamostragem correta quando o dispositivo for 44.1kHz/16kHz.
- Se o dispositivo vier com 2 canais, usar só um canal (o de maior nível), nunca somar.
- Logar track.getSettings() (sampleRate, channelCount, echoCancellation,
  autoGainControl, noiseSuppression) e o nome do dispositivo de entrada nos logs do app
  (anexados no Reportar problema).
- Testar com o mic forçado em 44.1kHz, 16kHz e 2 canais (configurações do Windows):
  a voz tem que sair igual à de 48kHz/1 canal.

### Configurações › Voz
- Teste de microfone com medidor de volume e "Ouvir minha voz" (retorno local já com os
  processamentos ligados, pra ouvir como os outros ouvem).
- Liga/desliga separados: supressão de ruído (RNNoise), cancelamento de eco e ganho
  automático (padrão: ligados). Sensibilidade automática ou manual.
- Mostrar o dispositivo em uso. Se o nome indicar fone Bluetooth em modo "Hands-Free",
  dica: "Fones Bluetooth perdem qualidade quando o microfone deles está ligado. Se
  puder, use outro microfone."

## 3.3 Bot oficial @aureum
Sem IA: regras fixas e mensagens prontas em pt-BR. Atua no servidor oficial (durante o
beta) e na DM oficial de cada usuário.

### Arquitetura
- Módulo bot dentro da API, reagindo a eventos que já existem. Sem processo separado e sem
  token por enquanto. Posta como @aureum (verificado + BOT).
- Templates das mensagens num arquivo fácil de editar.
- Cada ação liga/desliga pela CLI: bot enable|disable --acao ...
- A @aureum não aceita amizade, não pode ser convidada para servidores e não aparece na
  busca de usuários.

### Anti-impersonação
- O visual oficial depende de users.is_official (só pela CLI), nunca do conteúdo da mensagem.
- Contas comuns não podem usar nome de exibição igual ou parecido com "Aureum" (sem
  diferenciar maiúsculas, acentos e espaços: "Aure um", "AUREUM", "Auréum").

### Servidor oficial
- Canais por CLI: bot set-channel --acao <boas-vindas|bugs|avisos> --canal <id>. Sem canal
  configurado, a ação não roda. Só atua em servidores is_official.
- Boas-vindas: "⬢ @fulano chegou! Pioneiro nº X do Aureum. Seja bem-vindo(a)! Achou um
  bug? Manda no <canal de bugs>." Sem Pioneiro, sem o número. Menção real; o canal de bugs
  é o configurado (menção clicável, não texto fixo). No máximo 1 vez por usuário por
  servidor, mesmo se sair e voltar.
- Bug resolvido (público), no canal de bugs: "🐞 Bug resolvido: [título]. Valeu, @fulano!"
- bot say --canal <id> "mensagem" posta como @aureum (markdown simples).

### Bugs: resolvido vs. não é bug
- Na tela de bugs do dono, além de "Marcar como resolvido": "Fechar (não é bug)". Não
  concede Caçador de bugs, não posta no canal e não manda DM.

### DM oficial
- Conversa fixa "Aureum" no topo das DMs de todo usuário, criada na primeira mensagem.
- Só leitura: no lugar da caixa de texto, "Esta é uma conversa oficial do Aureum. Pra
  falar com a gente, use o botão de bug ou o servidor do beta." A API recusa respostas
  com erro legível ("Esta conversa é só de leitura. Atualize o app.") para apps antigos.
- Pode silenciar, não pode bloquear. Silenciar só tira som e notificação; as mensagens
  continuam chegando. Segurança SEMPRE notifica, mesmo silenciada.
- Visual próprio (borda dourada sutil) e rodapé fixo: "O Aureum nunca pede sua senha ou
  código." Nenhuma conta comum consegue esse visual.
- Categorias:
  - seguranca: senha alterada, e-mail alterado, login novo. Obrigatória.
    Login novo = dispositivo/instalação que nunca logou nessa conta (identificador gerado
    e guardado pelo app). Não guardar IP. Mensagem com data, hora e SO, e "Não foi você?
    Troque sua senha agora." (Os e-mails de segurança do 2.10 continuam.)
  - insignias: "Você ganhou a insígnia X!", com a insígnia grande.
  - bugs: "Seu bug [título] foi resolvido. Valeu!" (+ insígnia na primeira vez).
  - convites: "@fulano entrou com o seu convite!" (quando o convidado confirma o e-mail).
  - novidades: resumo de versão nova (por enquanto via broadcast).
  - avisos: avisos gerais.
- Configurações › Notificações: liga/desliga por categoria (menos segurança).

### Broadcast e proteção
- bot broadcast --categoria <avisos|novidades> "mensagem" para todos que aceitam a
  categoria. Mostra quantas pessoas vão receber e pede confirmação (--yes pula). Envio
  pela fila, com limite de ritmo.
- Deduplicação: a mesma mensagem nunca vai duas vezes pro mesmo usuário. Se o broadcast
  for interrompido, rodar o mesmo comando continua de onde parou.

### Ordem de entrega
- A parte de API (eventos, servidor oficial, envio das DMs, CLI) pode subir em produção
  antes do release, seguindo as regras de produção. A tela da DM oficial e Configurações ›
  Notificações vão no release seguinte.
- Conferir que, no app da versão anterior, as DMs oficiais aparecem como DM normal sem
  quebrar nada.

### Testes
Boas-vindas com e sem Pioneiro e sem repetir; não roda fora do oficial nem sem canal;
bot say; cada categoria de DM; categoria desligada não recebe; segurança sempre chega e
notifica mesmo silenciada; login novo só em dispositivo novo; DM só leitura (inclusive via
API direta); ninguém além da @aureum consegue o visual oficial; nome "Aureum" e variações
recusados; broadcast com contagem, confirmação e retomada; deduplicação; amizade e convite
para a @aureum recusados; "Fechar (não é bug)" não concede nada.

## 3.4 Áudio dentro da call
- Setinha ao lado dos botões de microfone e fone na barra da call abre um popover:
  entrada, saída, volume de entrada e de saída, modo (Detecção de voz / Pressionar para
  falar), sensibilidade e link para Configurações › Voz.
- Troca de dispositivo sem sair da call (LiveKit switchActiveDevice para audioinput e
  audiooutput). Escolha salva como preferência.
- Ouvir devicechange: headset conectado aparece na hora; se o dispositivo em uso sumir,
  cai pro padrão do Windows com aviso discreto.
- Testes: trocar entrada e saída em call, dispositivo removido no meio da call.

## 3.5 Insígnias
- Pioneiro limitado aos 15 primeiros: AUREUM_PIONEER_LIMIT=15 no .env (números
  reservados contam). Atingido o limite, não concede mais, mesmo com AUREUM_BETA=true.
  Números já concedidos não mudam.
- Nova insígnia "Beta Tester" (LENDÁRIA, não numerada, exclusive_beta): concedida na
  confirmação do e-mail enquanto AUREUM_BETA=true. Pioneiros também recebem. Retroativa
  para todas as contas não oficiais já existentes (comando mostrado antes). Nunca mais
  concedida depois do beta. Ícone: SVG próprio, placeholder de frasco de laboratório.
- A concessão manda a DM da categoria insignias (com deduplicação).
- Descrições (tooltip e cartão):
  - Fundador: "Criou o Aureum. Tudo começou aqui."
  - Pioneiro: "Um dos 15 primeiros a chegar no Aureum."
  - Beta Tester: "Testou o Aureum no beta e ajudou a moldar o app."
  - Caçador de bugs: "Encontrou um bug de verdade e ajudou a corrigir."
  - Veterano: "Faz parte do Aureum há mais de um ano."
  - Construtor: "Criou um servidor com 5 ou mais membros."
  - Aureum+: "Apoia o Aureum com o plano Aureum+."
- Testes: limite do Pioneiro (inclusive concorrência no nº 15), Beta Tester na
  confirmação e retroativa, conta oficial não recebe nenhuma das duas.

## 3.6 Edição de perfil fora das Configurações
- Avatar no topo → "Ver perfil" abre o cartão de perfil (resumo); no próprio perfil,
  botão "Editar perfil".
- "Editar perfil" abre um modal dedicado: avatar, banner, cor do cartão, moldura,
  pronomes, status, Sobre mim, música, links, com prévia ao vivo do cartão ao lado.
  Botão Salvar e aviso de alterações não salvas.
- Configurações › Perfil abre o mesmo componente (um só, sem duplicar código).

## 3.7 Painel de sons
Nome na interface: "Painel de sons" (não usar "Soundboard" nem "Soundpad").
- Sons por servidor: máx 5s, máx 1 MB, mp3/ogg/wav, até 24 por servidor; nome e volume
  padrão. Duração validada no servidor (dependência nova: perguntar antes, licença
  permissiva). Armazenados no MinIO.
- Permissões novas: USE_SOUNDBOARD (padrão: permitido ao @everyone) e MANAGE_SOUNDBOARD.
- Botão na barra da call abre a grade de sons. Toca como TRACK DE ÁUDIO SEPARADA no
  LiveKit, nunca misturada no microfone (não passa pela supressão de ruído). Precisa de
  SPEAK; não toca se o usuário estiver mutado pelo servidor.
- Anti-spam: 1 som por vez por usuário, cooldown de 3s.
- Cada pessoa: volume do painel de sons (0–100%) e "Silenciar sons dos outros".
- Testes: limites de arquivo e duração, permissões, cooldown, silenciar.

## 3.8 Identidade visual (prazo: fim de 2026)
NÃO começar sem spec detalhada do Eduardo. Escopo previsto:
- Logo final (o atual é o oficial até lá; trocar tudo via npm run build:icons).
- Revisão de cores e tokens do 2.1.
- Mascote da marca (ideias em aberto: abelha "Zum", "Pepita", vaga-lume "Lume"),
  original de verdade, legível de 24px a ilustração grande. Usos: estados vazios,
  carregamento, erro de conexão, e-mails, figurinhas.

## 3.9 Migração para a Oracle (quando a VM estiver pronta)
NÃO começar sem spec detalhada. Escopo previsto: VM A1 Always Free (PAYG com tudo grátis
e alerta de gasto), API + Postgres + Redis + MinIO + LiveKit na VM, HTTPS, migração dos
dados com backup e janela de manutenção avisada pela @aureum, troca de URLs no app sem
quebrar instalações existentes, fim do Tailscale Funnel e do LiveKit Cloud.

## Backlog (não fazer agora)
- Landing page (docs/design/landing/) e o convite de grupo do WhatsApp
  (invites create --usos 15 --dias 7), passo 6 pendente do lançamento.
- Login com Google e Discord; importar servidores do Discord.
- Bot: anúncio automático de release, marcos de pioneiros, comandos /ajuda, /convites e
  /status, tirar a @aureum dos servidores depois do beta, bots externos com token.
- Painel de sons: sons padrão próprios (gerados pelo script de síntese).
- Cinema (assistir junto), mapa Minecraft (BlueMap), status de servidor de Mine, fichas
  de RPG, ouvir junto no Spotify.
- Aureum+ (qualidade de transmissão maior); Kanban como produto separado.

## Pronto quando (Fase 3)
- Release sai com um rascunho só e o app se atualiza sozinho em todas as versões.
- Ícone novo em exe, instalador, janela, barra de tarefas, bandeja e insígnia Fundador.
- Conta-gotas fluido; overlay só em jogo; tela cheia com botão de sair.
- Voz limpa com o headset Havit do beta; teste de microfone em Configurações.
- @aureum dá boas-vindas, avisa bug resolvido e manda DMs oficiais só leitura por categoria.
- Trocar microfone e saída dentro da call.
- 15 Pioneiros no máximo; todos os testers com Beta Tester.
- Perfil editado direto do cartão; painel de sons funcionando na call.
- App rodando na VM da Oracle, sem depender do PC do Eduardo.