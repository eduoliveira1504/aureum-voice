import { shortcut } from '../lib/platform'
import { useChat } from '../store/chat'
import { useNav } from '../store/nav'
import type { TourStep } from './Tour'

/**
 * The first tour (block 3.16), on the Aureum's own layout. The guide is the official logo.
 * New steps get `since` = the new TOUR_VERSION (lib/onboarding.ts); anchors.test.ts checks that
 * every anchor below exists in the app.
 */

/** The official server if the person is in it (owned by @aureum), else their first server. */
export function tourServer(): string | null {
  const { servers, order } = useChat.getState()
  const list = order.map((id) => servers[id]).filter((s) => !!s)
  const official = list.find((s) => s.members.find((m) => m.user.id === s.owner_id)?.user.is_official)
  return (official ?? list[0])?.id ?? null
}

/** Opens the tour's server with the overview showing in the first panel. */
function openTourServer(): void {
  const id = tourServer()
  if (!id) return
  const nav = useNav.getState()
  if (nav.place !== id) nav.openServer(id)
  nav.activateTab(id, 0, 'overview')
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    since: 1,
    title: 'Bem-vindo ao Aureum!',
    text: 'Bora dar uma volta rápida? Leva menos de um minuto, e dá pra sair quando quiser (Esc).',
    next: 'Começar'
  },
  {
    id: 'tabs',
    since: 1,
    anchor: 'abas',
    title: 'Abas no topo',
    text: 'O Início fica sempre primeiro e cada servidor ganha a sua aba (arraste pra mudar a ordem). No "+" você cria, entra ou reabre um servidor.'
  },
  {
    id: 'home',
    since: 1,
    anchor: 'inicio',
    title: 'Início: o seu hub',
    text: 'Quem está ao vivo, seus servidores, o que você perdeu, suas tarefas e um calendário que junta os eventos e prazos de todos os servidores. Amigos e conversas privadas ficam na barra lateral.',
    prepare: () => useNav.getState().openHome('hub')
  },
  {
    id: 'sidebar',
    since: 1,
    needsServer: true,
    anchor: 'sidebar',
    title: 'Barra lateral do servidor',
    text: 'Categorias com as salas de voz, as conversas e os addons. Clique numa sala pra entrar na call. Precisa de espaço? Recolha a barra pelo botão no alto dela.',
    prepare: openTourServer
  },
  {
    id: 'overview',
    since: 1,
    needsServer: true,
    anchor: 'visao-geral',
    title: 'Visão geral',
    text: 'As salas ao vivo, quem está falando ou transmitindo e os próximos eventos do servidor, tudo numa tela só.',
    prepare: openTourServer
  },
  {
    id: 'panels',
    since: 1,
    needsServer: true,
    anchor: 'paineis',
    title: 'Painéis lado a lado',
    text: 'Abra até 4 coisas ao mesmo tempo: chat, call, Kanban... Arraste um canal até a borda de um painel ou use os botões de dividir no canto dele.',
    prepare: openTourServer
  },
  {
    id: 'members',
    since: 1,
    needsServer: true,
    anchor: 'membros',
    title: 'Membros',
    get text() {
      return `A lista de membros fica numa barra só, à direita, seja qual for o painel aberto. Abre e fecha aqui ou com ${shortcut('Ctrl+Shift+U')}.`
    },
    prepare: openTourServer
  },
  {
    id: 'addons',
    since: 1,
    needsServer: true,
    anchor: 'addons',
    centerIfMissing: true,
    title: 'Addons',
    text: 'Kanban, Quadro, Eventos e Calendário moram dentro do servidor, como canais. O Calendário junta num lugar só os prazos do Kanban e os eventos.',
    prepare: openTourServer
  },
  {
    id: 'profile',
    since: 1,
    anchor: 'perfil',
    title: 'Seu perfil',
    get text() {
      return `No avatar você vê e edita o perfil (avatar e banner aceitam GIF) e a sua Conta, muda o status, abre as Configurações e reporta um problema (${shortcut('Ctrl+Shift+R')}).`
    }
  },
  {
    id: 'bell',
    since: 1,
    anchor: 'sino',
    title: 'Notificações',
    text: 'O sino mostra pedidos de amizade, chamadas perdidas e as novidades de cada versão do Aureum.'
  },
  {
    id: 'done',
    since: 1,
    title: 'Pronto!',
    text: 'Quando você usar algo pela primeira vez, a gente mostra uma dica. Numa call, "Destacar" leva a chamada pra uma janela própria, por cima de tudo. Pra rever este tour, é só ir no menu do perfil.',
    next: 'Concluir'
  }
]
