import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { GFM } from '@lezer/markdown'
import { tags as t } from '@lezer/highlight'
import { oneDark } from '@codemirror/theme-one-dark'
import { livePreview } from './livePreview'

// Stile per il SOLO codice (dentro i blocchi ```): colora i token di programmazione
// ma NON i tag markdown (titoli/grassetto restano neutri in Ibrida).
const codeHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c678dd' },
  { tag: [t.function(t.variableName), t.labelName], color: '#61afef' },
  { tag: [t.constant(t.name), t.standard(t.name), t.bool, t.atom], color: '#d19a66' },
  { tag: [t.typeName, t.className, t.number, t.annotation, t.self], color: '#e5c07b' },
  { tag: [t.operator, t.operatorKeyword], color: '#56b6c2' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#98c379' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7d8799', fontStyle: 'italic' },
  { tag: [t.propertyName], color: '#e06c75' },
  { tag: [t.meta, t.punctuation], color: '#abb2bf' },
])

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
  livePreviewMode = false,
  viewRef,
}: {
  value: string
  onChange: (v: string) => void
  markdownMode: boolean
  livePreviewMode?: boolean
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

    // In Ibrida NON usiamo oneDark: il tema "documento" di livePreview controlla
    // sfondo/colori. In Codice usiamo oneDark pieno (sfondo + syntax highlight).
    const liveMode = markdownMode && livePreviewMode
    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      liveMode ? [] : oneDark,
      // In Ibrida: evidenzia solo il codice nei blocchi, non il markdown.
      liveMode ? syntaxHighlighting(codeHighlightStyle) : [],
      baseTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !settingExternally.current) {
          onChangeRef.current(u.state.doc.toString())
        }
      }),
    ]
    if (markdownMode) extensions.push(markdown({ extensions: GFM, codeLanguages: languages }))
    if (liveMode) extensions.push(livePreview())

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
    // gli aggiornamenti successivi sono gestiti dall'effetto sotto. L'editor si
    // ricrea quando cambia la modalità (markdown/plain o live preview on/off).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdownMode, livePreviewMode])

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
