import '@excalidraw/excalidraw/index.css'
import './whiteboard.css'

import { Excalidraw, exportToClipboard, MainMenu, restoreElements } from '@excalidraw/excalidraw'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { Copy, Grid3x3, History, Square } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { User } from '../../lib/api'
import { useAppearance } from '../../store/appearance'
import { BoardSync, type SyncStatus } from './BoardSync'
import { onLive, useWhiteboard, type BoardScene } from './store'
import { VersionsModal } from './VersionsModal'

// The fonts come with the app (see electron.vite.config.ts), never from Excalidraw's CDN.
window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw/', document.baseURI).href

export interface EditorProps {
  channelId: string
  board: BoardScene
  people: Map<string, User>
  onStatus(status: SyncStatus): void
  onError(message: string): void
}

/**
 * The board itself: Excalidraw, themed with the app's tokens, kept in sync by BoardSync.
 * Loaded on demand (it's most of the addon's weight). No AI tools, embeds or online library.
 */
export default function Editor({ channelId, board, people, onStatus, onError }: EditorProps): ReactNode {
  const theme = useAppearance((s) => s.resolved)
  const background = useWhiteboard((s) => s.lists[channelId]?.boards.find((b) => b.id === board.id)?.background) ?? board.background
  const peopleRef = useRef(people)
  peopleRef.current = people
  const statusRef = useRef(onStatus)
  statusRef.current = onStatus
  const sync = useMemo(
    () =>
      new BoardSync({
        channelId,
        board,
        canEdit: board.can_edit,
        people: () => peopleRef.current,
        onStatus: (status) => statusRef.current(status)
      }),
    [channelId, board]
  )
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null)
  const [versions, setVersions] = useState(false)

  useEffect(() => {
    const off = onLive((event) => sync.handle(event))
    return () => {
      off()
      sync.dispose()
    }
  }, [sync])

  const initialData = useMemo(
    () => ({
      elements: restoreElements(board.elements as unknown as ExcalidrawElement[], null),
      // Transparent, so the app's own background shows through in both themes.
      appState: { viewBackgroundColor: 'transparent' },
      scrollToContent: true
    }),
    [board]
  )

  async function copyImage(): Promise<void> {
    if (!excalidraw) return
    try {
      await exportToClipboard({
        type: 'png',
        elements: excalidraw.getSceneElements(),
        files: excalidraw.getFiles(),
        appState: { exportBackground: true, viewBackgroundColor: '#ffffff', exportWithDarkMode: false }
      })
      excalidraw.setToast({ message: 'Imagem copiada. Cole no chat com Ctrl+V.', duration: 3000 })
    } catch {
      onError('Não foi possível copiar a imagem.')
    }
  }

  function toggleBackground(): void {
    void useWhiteboard
      .getState()
      .update(channelId, board.id, { background: background === 'grid' ? 'plain' : 'grid' })
      .catch(() => onError('Não foi possível mudar o fundo.'))
  }

  return (
    <div className="aureum-whiteboard relative min-h-0 flex-1 bg-main">
      <Excalidraw
        excalidrawAPI={(api) => {
          sync.attach(api)
          setExcalidraw(api)
        }}
        initialData={initialData}
        onChange={(elements, _appState, files) => sync.onChange(elements, files)}
        onPointerUpdate={({ pointer, button }) => sync.onPointer({ ...pointer, button })}
        onScrollChange={() => sync.onScroll()}
        onUserFollow={(payload) => sync.onUserFollow(payload)}
        isCollaborating
        viewModeEnabled={!board.can_edit}
        gridModeEnabled={background === 'grid'}
        theme={theme}
        langCode="pt-BR"
        name={board.name}
        aiEnabled={false}
        validateEmbeddable={false}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: board.can_edit,
            export: false,
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: true,
            // Follows the app's theme.
            toggleTheme: null
          },
          tools: { image: board.can_edit }
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.Item icon={<Copy size={16} />} onSelect={() => void copyImage()}>
            Copiar como imagem
          </MainMenu.Item>
          {board.can_edit && (
            <MainMenu.Item icon={background === 'grid' ? <Square size={16} /> : <Grid3x3 size={16} />} onSelect={toggleBackground}>
              {background === 'grid' ? 'Fundo liso' : 'Fundo quadriculado'}
            </MainMenu.Item>
          )}
          <MainMenu.Item icon={<History size={16} />} onSelect={() => setVersions(true)}>
            Versões
          </MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          {board.can_edit && <MainMenu.DefaultItems.ClearCanvas />}
        </MainMenu>
      </Excalidraw>
      {versions && (
        <VersionsModal
          channelId={channelId}
          board={board}
          people={people}
          onRestored={(elements) => sync.applyRemote(elements)}
          onClose={() => setVersions(false)}
        />
      )}
    </div>
  )
}
