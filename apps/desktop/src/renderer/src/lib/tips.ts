/**
 * First-time tips (block 3.16): one balloon the first time something happens; "Entendi" closes it
 * for good (saved in user_settings.onboarding.tips_seen, so the key is what's remembered: never
 * rename one). `anchor` is the data-tour of the element it points at; anchors.test.ts checks that
 * it exists in the app.
 */
export interface TipDef {
  anchor: string
  title: string
  text: string
}

export const TIPS = {
  'call.controls': {
    anchor: 'call-controles',
    title: 'Sua barra da call',
    text: 'Microfone, áudio, câmera e tela ficam aqui; a setinha ao lado de cada um troca o aparelho (microfone, saída e câmera). No alto da call, Foco e Grade mudam o jeito de ver as pessoas. Saiu da tela da call? Ela vira uma janelinha flutuante, e "Destacar" leva a chamada pra uma janela própria, por cima de tudo.'
  },
  'call.soundboard': {
    anchor: 'painel-sons',
    title: 'Painel de sons',
    text: 'Toque um som curto pra todo mundo da sala. Não quer ouvir os sons dos outros? No próprio painel tem o volume e "Silenciar sons dos outros".'
  },
  'call.overlay': {
    anchor: 'call-controles',
    title: 'Overlay nos jogos',
    text: 'Enquanto você joga, o Aureum mostra por cima do jogo quem está falando, as câmeras e os avisos, em widgets separados. Ele só aparece em jogos, nunca em outros programas. Em Configurações › Overlay você muda a posição de cada widget e o formato das câmeras.'
  },
  'screen.watch': {
    anchor: 'assistir',
    title: 'Tem alguém transmitindo',
    text: 'Nada da transmissão chega antes do clique: aperte Assistir pra entrar na live.'
  },
  'screen.watching': {
    anchor: 'tela-assistida',
    title: 'Assistindo uma tela',
    text: 'Passe o mouse na transmissão: no canto de baixo ficam o volume dela (fica salvo pra essa pessoa), a tela cheia e o botão de parar de assistir. Dois cliques também abrem a tela cheia.'
  },
  'screen.share': {
    anchor: 'modo-tela',
    title: 'Texto nítido ou Movimento',
    text: 'Texto nítido deixa letras, código e planilhas legíveis; Movimento prioriza a fluidez, melhor pra jogos e vídeos. Escolha conforme o que você vai mostrar.'
  },
  'server.owner': {
    anchor: 'menu-servidor',
    title: 'Seu servidor',
    text: 'Neste menu ficam os convites e as configurações do servidor: categorias, cargos e quem vê cada canal (canal privado). Pra mudar a ordem de canais e categorias, é só arrastar na barra lateral.'
  },
  'addon.kanban': {
    anchor: 'addon',
    title: 'Kanban',
    text: 'Organize tarefas em colunas: crie cartões e arraste entre elas, com responsável e prazo. Os prazos aparecem no Calendário e em Minhas tarefas, no Início.'
  },
  'addon.whiteboard': {
    anchor: 'addon',
    title: 'Quadro',
    text: 'Um quadro branco pra desenhar junto, em tempo real: formas, setas, texto e imagens. Todo mundo do canal vê as mudanças na hora.'
  },
  'addon.events': {
    anchor: 'addon',
    title: 'Eventos',
    text: 'Marque encontros do servidor com data e hora. Cada pessoa responde Vou, Talvez ou Não vou, o @aureum lembra quem vai antes de começar e o evento aparece no Calendário e no Início.'
  },
  'addon.calendar': {
    anchor: 'addon',
    title: 'Calendário',
    text: 'Junta numa vista só os eventos e os prazos do Kanban do servidor, por mês, semana ou lista. Clique num item pra abrir onde ele está.'
  },
  'chat.polls': {
    anchor: 'chat-mais',
    title: 'Enquetes e anexos',
    text: 'No + você anexa arquivos ou cria uma enquete pra conversa votar.'
  },
  'chat.reactions': {
    anchor: 'reacoes',
    title: 'Reações',
    text: 'Pra reagir, passe o mouse na mensagem e escolha um emoji (lá também ficam responder e encaminhar). Clicar numa reação que já existe soma a sua.'
  },
  'dm.receipts': {
    anchor: 'conversa',
    title: 'Mensagem privada',
    text: 'O ✓✓ embaixo da sua mensagem mostra que a pessoa já viu. Prefere não mostrar? Desligue a Confirmação de leitura em Configurações › Privacidade (aí você também não vê quando os outros leem).'
  },
  'dm.official': {
    anchor: 'conversa',
    title: 'Conversa oficial',
    text: 'Esta é a conversa oficial do Aureum: avisos, segurança e novidades. A gente nunca pede sua senha.'
  },
  'people.menu': {
    anchor: 'menu-contexto',
    title: 'Menu de contexto',
    text: 'O botão direito em qualquer pessoa, no chat, na call ou na lista de membros, abre este menu com tudo o que dá pra fazer com ela.'
  },
  'ptt.key': {
    anchor: 'ptt-tecla',
    title: 'Pressionar para falar',
    text: 'É aqui que fica a sua tecla de falar: segure ela numa call pra abrir o microfone. Pra trocar, clique aqui e aperte outra tecla ou um botão lateral do mouse.'
  }
} satisfies Record<string, TipDef>

/** The tip of each addon's panel, by addon key. */
export const ADDON_TIPS: Partial<Record<string, TipKey>> = {
  kanban: 'addon.kanban',
  whiteboard: 'addon.whiteboard',
  events: 'addon.events',
  calendar: 'addon.calendar'
}

export type TipKey = keyof typeof TIPS
