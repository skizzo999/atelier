import { useMemo, useState } from 'react'

// Strumenti rapidi da sviluppatore: JSON, espressioni regolari, confronto
// testi, codifiche. Tutto in locale, nessuna dipendenza esterna.

type Tool = 'json' | 'regex' | 'diff' | 'encode'

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'json', label: 'JSON' },
  { id: 'regex', label: 'Regex' },
  { id: 'diff', label: 'Confronta' },
  { id: 'encode', label: 'Codifica' },
]

const areaCls =
  'w-full h-full bg-white border border-zinc-700 rounded-md p-2 font-mono text-[12px] text-zinc-200 resize-none focus:border-blue-500 focus:outline-none'

export function ToolBox() {
  const [tool, setTool] = useState<Tool>('json')
  return (
    <div className="flex-1 flex min-h-0">
      <div className="w-32 shrink-0 border-r border-zinc-800 py-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-800 ${
              tool === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-w-0 p-2">
        {tool === 'json' ? <JsonTool /> : tool === 'regex' ? <RegexTool /> : tool === 'diff' ? <DiffTool /> : <EncodeTool />}
      </div>
    </div>
  )
}

// ---- JSON: formatta, minifica, valida ----
function JsonTool() {
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')

  function transform(minify: boolean) {
    try {
      const parsed = JSON.parse(text)
      setText(JSON.stringify(parsed, null, minify ? 0 : 2))
      setMsg(minify ? 'Minificato.' : 'Formattato.')
    } catch (e) {
      setMsg(`✕ ${(e as Error).message}`)
    }
  }

  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <button className="tbtn" onClick={() => transform(false)}>
          Formatta
        </button>
        <button className="tbtn" onClick={() => transform(true)}>
          Minifica
        </button>
        <button
          className="tbtn"
          onClick={() => {
            try {
              JSON.parse(text)
              setMsg('✓ JSON valido.')
            } catch (e) {
              setMsg(`✕ ${(e as Error).message}`)
            }
          }}
        >
          Valida
        </button>
        <span className={`text-xs ${msg.startsWith('✕') ? 'text-red-400' : 'text-emerald-400'}`}>{msg}</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setMsg('')
        }}
        spellCheck={false}
        placeholder="Incolla qui il JSON…"
        className={areaCls}
      />
    </div>
  )
}

// ---- Espressioni regolari: prova e vedi le corrispondenze ----
function RegexTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [text, setText] = useState('')

  const result = useMemo(() => {
    if (!pattern) return { error: '', parts: [{ t: text, hit: false }], count: 0 }
    try {
      const re = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g')
      const parts: { t: string; hit: boolean }[] = []
      let last = 0
      let count = 0
      for (const m of text.matchAll(re)) {
        const i = m.index ?? 0
        if (m[0] === '') continue // evita cicli infiniti sui match vuoti
        if (i > last) parts.push({ t: text.slice(last, i), hit: false })
        parts.push({ t: m[0], hit: true })
        last = i + m[0].length
        count++
      }
      if (last < text.length) parts.push({ t: text.slice(last), hit: false })
      return { error: '', parts, count }
    } catch (e) {
      return { error: (e as Error).message, parts: [{ t: text, hit: false }], count: 0 }
    }
  }, [pattern, flags, text])

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-2">
        <span className="text-zinc-500 font-mono text-xs">/</span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="espressione"
          spellCheck={false}
          className="flex-1 bg-white border border-zinc-700 rounded-md px-2 py-1 font-mono text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
        />
        <span className="text-zinc-500 font-mono text-xs">/</span>
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value.replace(/[^gimsuy]/g, ''))}
          className="w-16 bg-white border border-zinc-700 rounded-md px-2 py-1 font-mono text-xs text-zinc-200 focus:border-blue-500 focus:outline-none"
        />
        <span className={`text-xs shrink-0 ${result.error ? 'text-red-400' : 'text-zinc-500'}`}>
          {result.error ? '✕ regex non valida' : `${result.count} corrisp.`}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder="Testo su cui provare…"
        className={`${areaCls} h-24 shrink-0`}
      />
      <div className="flex-1 overflow-auto bg-zinc-900 border border-zinc-800 rounded-md p-2 font-mono text-[12px] whitespace-pre-wrap break-words">
        {result.parts.map((p, i) =>
          p.hit ? (
            <mark key={i} className="bg-blue-600 text-white rounded-sm">
              {p.t}
            </mark>
          ) : (
            <span key={i} className="text-zinc-400">
              {p.t}
            </span>
          ),
        )}
      </div>
    </div>
  )
}

// ---- Confronto testi (per righe, LCS) ----
function DiffTool() {
  const [a, setA] = useState('')
  const [b, setB] = useState('')

  const rows = useMemo(() => diffLines(a.split('\n'), b.split('\n')), [a, b])

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="flex gap-2 h-24 shrink-0">
        <textarea value={a} onChange={(e) => setA(e.target.value)} spellCheck={false} placeholder="Testo originale" className={areaCls} />
        <textarea value={b} onChange={(e) => setB(e.target.value)} spellCheck={false} placeholder="Testo modificato" className={areaCls} />
      </div>
      <div className="flex-1 overflow-auto bg-zinc-900 border border-zinc-800 rounded-md p-2 font-mono text-[12px]">
        {rows.map((r, i) => (
          <div
            key={i}
            className={r.kind === '+' ? 'text-emerald-400' : r.kind === '-' ? 'text-red-400' : 'text-zinc-500'}
          >
            {r.kind === '=' ? '  ' : r.kind + ' '}
            {r.text || ' '}
          </div>
        ))}
      </div>
    </div>
  )
}

// Diff per righe con la classica tabella LCS: righe uguali, tolte, aggiunte.
function diffLines(a: string[], b: string[]): { kind: '=' | '-' | '+'; text: string }[] {
  const n = a.length
  const m = b.length
  if (n * m > 1_000_000) return [{ kind: '=', text: '(testi troppo grandi per il confronto)' }]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: { kind: '=' | '-' | '+'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: '=', text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: '-', text: a[i++] })
    } else {
      out.push({ kind: '+', text: b[j++] })
    }
  }
  while (i < n) out.push({ kind: '-', text: a[i++] })
  while (j < m) out.push({ kind: '+', text: b[j++] })
  return out
}

// ---- Codifiche: base64, URL, hash ----
function EncodeTool() {
  const [text, setText] = useState('')
  const [out, setOut] = useState('')

  const apply = async (fn: () => string | Promise<string>) => {
    try {
      setOut(await fn())
    } catch (e) {
      setOut(`✕ ${(e as Error).message}`)
    }
  }

  // UTF-8 sicuro (btoa da solo si strozza sugli accenti).
  const b64encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
  const b64decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))
  const sha256 = async (s: string) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('')
  }

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button className="tbtn" onClick={() => void apply(() => b64encode(text))}>
          Base64 →
        </button>
        <button className="tbtn" onClick={() => void apply(() => b64decode(text))}>
          ← Base64
        </button>
        <div className="tsep" />
        <button className="tbtn" onClick={() => void apply(() => encodeURIComponent(text))}>
          URL →
        </button>
        <button className="tbtn" onClick={() => void apply(() => decodeURIComponent(text))}>
          ← URL
        </button>
        <div className="tsep" />
        <button className="tbtn" onClick={() => void apply(() => sha256(text))}>
          SHA-256
        </button>
        <button
          className="tbtn"
          onClick={() => {
            navigator.clipboard.writeText(out).catch(() => {})
          }}
          disabled={!out}
        >
          Copia risultato
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder="Testo di partenza…"
        className={`${areaCls} h-24 shrink-0`}
      />
      <textarea readOnly value={out} spellCheck={false} placeholder="Risultato" className={`${areaCls} flex-1`} />
    </div>
  )
}
