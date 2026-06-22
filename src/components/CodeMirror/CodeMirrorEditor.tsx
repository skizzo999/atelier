import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

// Tema di base: riempie l'altezza, font monospazio, niente outline di focus.
const baseTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '16px' },
  '&.cm-focused': { outline: 'none' },
})

// Editor di testo basato su CodeMirror 6, integrato con lo stato React.
// `value` è la fonte di verità lato React; le modifiche dell'utente risalgono
// via `onChange`, mentre i cambi esterni di `value` (cambio file) vengono
// applicati al documento senza ri-emettere onChange.
export function CodeMirrorEditor({
  value,
  onChange,
  markdownMode,
  viewRef,
}: {
  value: string
  onChange: (v: string) => void
  markdownMode: boolean
  viewRef?: React.MutableRefObject<EditorView | null>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const settingExternally = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Crea l'editor (ricreato solo se cambia la modalità markdown/plain).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      oneDark,
      baseTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !settingExternally.current) {
          onChangeRef.current(u.state.doc.toString())
        }
      }),
    ]
    if (markdownMode) extensions.push(markdown())

    const v = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: host,
    })
    view.current = v
    if (viewRef) viewRef.current = v

    return () => {
      v.destroy()
      view.current = null
      if (viewRef) viewRef.current = null
    }
    // `value` volutamente escluso: il valore iniziale basta alla creazione,
    // gli aggiornamenti successivi sono gestiti dall'effetto sotto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownMode])

  // Applica i cambi esterni di `value` (es. caricamento di un nuovo file).
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (value !== cur) {
      settingExternally.current = true
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
      settingExternally.current = false
    }
  }, [value])

  return <div ref={hostRef} className="flex-1 overflow-hidden" />
}
