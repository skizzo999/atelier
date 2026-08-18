// Comando per ESEGUIRE il file aperto, dedotto dall'estensione. Serve al
// tasto "Esegui" dell'editor: la riga finisce nel terminale della modalità
// Developer, che la passa all'interprete di sistema.

interface Runner {
  /** Riga di comando, col percorso del file già fra virgolette. */
  cmd: (quotedPath: string) => string
  /** Come si chiama l'azione nel bottone (es. "Esegui", "Avvia"). */
  label: string
}

const RUNNERS: Record<string, Runner> = {
  py: { cmd: (f) => `python ${f}`, label: 'Esegui' },
  pyw: { cmd: (f) => `python ${f}`, label: 'Esegui' },
  js: { cmd: (f) => `node ${f}`, label: 'Esegui' },
  mjs: { cmd: (f) => `node ${f}`, label: 'Esegui' },
  cjs: { cmd: (f) => `node ${f}`, label: 'Esegui' },
  ts: { cmd: (f) => `npx tsx ${f}`, label: 'Esegui' },
  ps1: { cmd: (f) => `& ${f}`, label: 'Esegui' },
  sh: { cmd: (f) => `sh ${f}`, label: 'Esegui' },
  bat: { cmd: (f) => `& ${f}`, label: 'Esegui' },
  cmd: { cmd: (f) => `& ${f}`, label: 'Esegui' },
  rb: { cmd: (f) => `ruby ${f}`, label: 'Esegui' },
  php: { cmd: (f) => `php ${f}`, label: 'Esegui' },
  go: { cmd: (f) => `go run ${f}`, label: 'Esegui' },
  rs: { cmd: () => 'cargo run', label: 'Esegui' },
}

/** Il file si può eseguire? Torna il comando pronto, o null. */
export function runCommandFor(filePath: string): { command: string; label: string } | null {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const r = RUNNERS[ext]
  if (!r) return null
  return { command: r.cmd(`"${filePath}"`), label: r.label }
}

/** I file che si possono guardare renderizzati (anteprima nell'editor). */
export function isPreviewable(filePath: string): boolean {
  return /\.(html?|svg)$/i.test(filePath)
}
