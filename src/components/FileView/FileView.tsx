import { useAppStore } from '../../store/appStore'
import { Editor } from '../Editor/Editor'
import { ImageViewer } from '../ImageViewer/ImageViewer'
import { PdfViewer } from '../PdfViewer/PdfViewer'
import { DocxViewer } from '../DocxViewer/DocxViewer'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])

type FileKind = 'image' | 'pdf' | 'docx' | 'text'

function kindOf(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext && IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx') return 'docx'
  return 'text'
}

// Instrada il file selezionato verso il viewer giusto in base al tipo.
// Immagini → ImageViewer; PDF → PdfViewer; DOCX → DocxViewer; resto → Editor testo.
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
  if (kind === 'image') return <ImageViewer filePath={filePath} />
  if (kind === 'pdf') return <PdfViewer key={filePath} filePath={filePath} />
  if (kind === 'docx') return <DocxViewer key={filePath} filePath={filePath} />

  return <Editor />
}
