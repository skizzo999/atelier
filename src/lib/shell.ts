import { Command } from '@tauri-apps/plugin-shell'

// Esecuzione di comandi di sistema: alimenta il terminale e il pannello Git
// della modalità Developer. Gli interpreti consentiti sono dichiarati nello
// scope della capability (src-tauri/capabilities/default.json): la webview
// non può eseguire eseguibili arbitrari, solo passare una riga di comando
// a powershell (Windows) o sh (macOS/Linux).

const isWindows = () => navigator.userAgent.includes('Windows')

// Nome dello scope + argomenti per far eseguire UNA riga di comando.
function invocation(line: string): { name: string; args: string[] } {
  return isWindows()
    ? { name: 'run-powershell', args: ['-NoProfile', '-NonInteractive', '-Command', line] }
    : { name: 'run-sh', args: ['-c', line] }
}

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

// Esegue e aspetta il risultato completo. Per comandi brevi (git, ecc.).
export async function runCommand(line: string, cwd?: string): Promise<CommandResult> {
  const { name, args } = invocation(line)
  const out = await Command.create(name, args, cwd ? { cwd } : undefined).execute()
  return { code: out.code, stdout: out.stdout, stderr: out.stderr }
}

// Handle di un comando in corso: permette di interromperlo.
export interface RunningCommand {
  kill: () => Promise<void>
}

// Esegue in streaming: ogni riga di output arriva subito (terminale) e il
// processo si può interrompere. `onLine` riceve anche il flusso di
// provenienza, così stderr si può colorare diversamente.
export async function spawnCommand(
  line: string,
  cwd: string | undefined,
  onLine: (text: string, stream: 'out' | 'err') => void,
  onClose: (code: number | null) => void,
): Promise<RunningCommand> {
  const { name, args } = invocation(line)
  const cmd = Command.create(name, args, cwd ? { cwd } : undefined)
  cmd.stdout.on('data', (d: string) => onLine(d, 'out'))
  cmd.stderr.on('data', (d: string) => onLine(d, 'err'))
  cmd.on('close', (data: { code: number | null }) => onClose(data.code))
  cmd.on('error', (err: string) => {
    onLine(String(err), 'err')
    onClose(null)
  })
  const child = await cmd.spawn()
  return { kill: () => child.kill() }
}

// Risolve un `cd` relativo/assoluto contro la cartella corrente, senza
// toccare il disco (la verifica di esistenza la fa chi chiama).
export function resolveCd(cwd: string, target: string): string {
  const sep = isWindows() ? '\\' : '/'
  const t = target.trim().replace(/^["']|["']$/g, '')
  if (!t || t === '.') return cwd
  const absolute = isWindows() ? /^[a-zA-Z]:[\\/]/.test(t) || t.startsWith('\\\\') : t.startsWith('/')
  const base = absolute ? '' : cwd
  const parts = (base ? base.split(/[\\/]/) : []).concat(t.split(/[\\/]/))
  const stack: string[] = []
  for (const p of parts) {
    if (p === '' && stack.length) continue
    if (p === '.') continue
    if (p === '..') {
      if (stack.length > 1) stack.pop()
      continue
    }
    stack.push(p)
  }
  const joined = stack.join(sep)
  return isWindows() ? joined : joined.startsWith('/') ? joined : '/' + joined
}
