import { useAppStore } from '../../store/appStore'
import { Editor } from '../Editor/Editor'
import { ImageViewer } from '../ImageViewer/ImageViewer'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'])

type FileKind = 'image' | 'text'

function kindOf(path: string): FileKind {
  const ext = path.split('.').pop()?.toLowerCase()
  return ext && IMAGE_EXT.has(ext) ? 'image' : 'text'
}

// Instrada il file selezionato verso il viewer giusto in base al tipo.
// Per ora: immagini → ImageViewer; tutto il resto → Editor testo.
// Qui aggiungeremo PDF, DOCX, ecc.
export function FileView() {
  const filePath = useAppStore((s) => s.selectedFile)

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        Seleziona un file dalla sidebar per iniziare.
      </div>
    )
  }

  if (kindOf(filePath) === 'image') {
    return <ImageViewer filePath={filePath} />
  }

  return <Editor />
}
