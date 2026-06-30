import { Extension } from '@tiptap/core'

// Interlinea a livello di PARAGRAFO (come Word): l'estensione ufficiale di TipTap
// applica la line-height al mark inline (serve selezionare il testo) e con i nostri
// `types` non scriveva nulla. Questa la mette come attributo del nodo paragrafo/titolo,
// quindi basta avere il cursore dentro al paragrafo.

export interface LineHeightOptions {
  types: string[]
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    atelierLineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType
      unsetLineHeight: () => ReturnType
    }
  }
}

export const ParagraphLineHeight = Extension.create<LineHeightOptions>({
  name: 'paragraphLineHeight',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
            renderHTML: (attributes: { lineHeight?: string | null }) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ commands }) =>
          this.options.types.every((type) => commands.updateAttributes(type, { lineHeight })),
      unsetLineHeight:
        () =>
        ({ commands }) =>
          this.options.types.every((type) => commands.resetAttributes(type, 'lineHeight')),
    }
  },
})
