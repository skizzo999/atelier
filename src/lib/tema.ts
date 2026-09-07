import { useEffect, useState } from 'react'

// Chi ha bisogno di SAPERE che tema c'è — non basta scrivere una classe —
// guarda qui. La verità è una sola: l'attributo `data-tema` che App mette
// sulla radice del documento, chiunque lo abbia deciso (scelta esplicita
// dell'utente o impostazione del sistema).

/** True quando è attivo il tema scuro. */
export function useScuro(): boolean {
  const [scuro, setScuro] = useState(
    () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-tema') === 'scuro',
  )
  useEffect(() => {
    const leggi = () => setScuro(document.documentElement.getAttribute('data-tema') === 'scuro')
    leggi()
    const obs = new MutationObserver(leggi)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] })
    return () => obs.disconnect()
  }, [])
  return scuro
}

/**
 * Luminanza percepita (0 = nero, 1 = bianco) di un colore CSS in forma
 * `#rgb`, `#rrggbb` o `rgb(...)`. Serve a capire se un colore che arriva
 * DAL FILE sparirebbe sul fondo del tema corrente. Se non lo riconosce
 * torna 0.5: nel dubbio non si tocca niente.
 */
export function luminanza(css: string): number {
  let r: number, g: number, b: number
  const s = css.trim()
  if (s.startsWith('#')) {
    const h = s.slice(1)
    if (h.length === 3) {
      r = parseInt(h[0] + h[0], 16)
      g = parseInt(h[1] + h[1], 16)
      b = parseInt(h[2] + h[2], 16)
    } else if (h.length === 6 || h.length === 8) {
      r = parseInt(h.slice(0, 2), 16)
      g = parseInt(h.slice(2, 4), 16)
      b = parseInt(h.slice(4, 6), 16)
    } else return 0.5
  } else {
    const m = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s)
    if (!m) return 0.5
    r = Number(m[1])
    g = Number(m[2])
    b = Number(m[3])
  }
  if (![r, g, b].every(Number.isFinite)) return 0.5
  // Pesi ITU-R BT.601: l'occhio vede il verde più del blu.
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
