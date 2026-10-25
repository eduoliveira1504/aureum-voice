import { useEffect, useState, type ReactNode } from 'react'

import { labelClass } from './ui'

/** Open-source pieces the app is built on, as their packages declare them. */
const CREDITS: { name: string; what: string; license: string; url: string }[] = [
  { name: 'Excalidraw', what: 'O quadro branco', license: 'MIT', url: 'https://github.com/excalidraw/excalidraw' },
  { name: 'Electron', what: 'O app no Windows', license: 'MIT', url: 'https://github.com/electron/electron' },
  { name: 'React', what: 'A interface', license: 'MIT', url: 'https://github.com/facebook/react' },
  { name: 'LiveKit', what: 'Voz, câmera e tela', license: 'Apache-2.0', url: 'https://github.com/livekit/client-sdk-js' },
  { name: 'RNNoise (web-noise-suppressor)', what: 'Supressão de ruído', license: 'MIT', url: 'https://github.com/sapphi-red/web-noise-suppressor' },
  { name: 'Lucide', what: 'Ícones', license: 'ISC', url: 'https://github.com/lucide-icons/lucide' },
  { name: 'Zustand', what: 'Estado do app', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'Tailwind CSS', what: 'Estilos', license: 'MIT', url: 'https://github.com/tailwindlabs/tailwindcss' },
  { name: 'koffi', what: 'Detecção de jogos', license: 'MIT', url: 'https://github.com/Koromix/koffi' },
  { name: 'electron-updater', what: 'Atualizações', license: 'MIT', url: 'https://github.com/electron-userland/electron-builder' },
  { name: 'Sora e Figtree', what: 'Fontes', license: 'OFL-1.1', url: 'https://fontsource.org' }
]

// From https://github.com/excalidraw/excalidraw/blob/master/LICENSE
const EXCALIDRAW_LICENSE = `MIT License

Copyright (c) 2020 Excalidraw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** Configurações › Sobre: the app's version and the credits and licenses of what it uses. */
export function AboutSettings(): ReactNode {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    window.aureum.app.info().then((info) => setVersion(info.version), () => {})
  }, [])

  return (
    <div className="space-y-6">
      <section>
        <h3 className="font-display text-lg font-semibold">Aureum Voice</h3>
        <p className="text-sm text-fg-muted">{version ? `Versão ${version}` : ' '}</p>
      </section>

      <section>
        <h3 className={labelClass}>Créditos</h3>
        <p className="mb-3 text-sm text-fg-muted">O Aureum é feito sobre projetos de código aberto. Obrigado a quem os mantém.</p>
        <ul className="divide-y divide-line rounded-control border border-line bg-main">
          {CREDITS.map((c) => (
            <li key={c.name} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
              <span className="min-w-0">
                <a href={c.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {c.name}
                </a>
                <span className="block text-xs text-fg-subtle">{c.what}</span>
              </span>
              <span className="shrink-0 rounded-full bg-elevated px-2 py-0.5 text-xs text-fg-muted">{c.license}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className={labelClass}>Licenças</h3>
        <details className="rounded-control border border-line bg-main px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">Excalidraw (MIT)</summary>
          <p className="mt-2 text-xs text-fg-subtle">As fontes do quadro branco vêm com o Excalidraw, cada uma sob a licença dos seus autores.</p>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-fg-muted">{EXCALIDRAW_LICENSE}</pre>
        </details>
      </section>
    </div>
  )
}
