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
  }
} satisfies Record<string, TipDef>

export type TipKey = keyof typeof TIPS
