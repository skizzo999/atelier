import { lazy, Suspense } from 'react'
import { useAppStore } from '../../store/appStore'

// Viewer caricati PIGRAMENTE (code-split): ognuno porta con sé le sue librerie
// pesanti (pdf.js, TipTap+docx+mammoth, CodeMirror+highlight.js, annotazioni)
// che così escono dal bundle principale — l'app parte leggera e il chunk del
// viewer si scarica solo alla prima apertura di quel tipo di file.
const ImageViewer = lazy(() => import('../ImageViewer/ImageViewer').then((m) => ({ default: m.ImageViewer })))
const PdfViewer = lazy(() => import('../PdfViewer/PdfViewer').then((m) => ({ default: m.PdfViewer })))
const DocxEditor = lazy(() => import('../DocxEditor/DocxEditor').then((m) => ({ default: m.DocxEditor })))
const Editor = lazy(() => import('../Editor/Editor').then((m) => ({ default: m.Editor })))
const XlsxViewer = lazy(() => import('../XlsxViewer/XlsxViewer').then((m) => ({ default: m.XlsxViewer })))

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])

type FileKind = 'image' | 'pdf' | 'docx' | 'sheet' | 'text'

function kindOf(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext && IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'csv') return 'sheet'
  return 'text'
}

// Instrada il file selezionato verso il viewer giusto in base al tipo.
// Immagini → ImageViewer; PDF → PdfViewer; DOCX → DocxEditor; resto → Editor testo.
export function FileView() {
  const filePath = useAppStore((s) => s.selectedFile)

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        Seleziona un file dalla sidebar per iniziare.
      </div>
    )
  }

  const kind = kindOf(filePath)
  const spinner = (
    <div className="flex-1 flex items-center justify-center">
      <div className="h-7 w-7 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
    </div>
  )

  return (
    <Suspense fallback={spinner}>
      {kind === 'image' ? (
        <ImageViewer filePath={filePath} />
      ) : kind === 'pdf' ? (
        <PdfViewer key={filePath} filePath={filePath} />
      ) : kind === 'docx' ? (
        <DocxEditor key={filePath} filePath={filePath} />
      ) : kind === 'sheet' ? (
        <XlsxViewer key={filePath} filePath={filePath} />
      ) : (
        <Editor />
      )}
    </Suspense>
  )
}
