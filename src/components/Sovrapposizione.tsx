import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Pannelli a tutto schermo: finestre modali, menu contestuali, veli.
//
// Devono stare FUORI dall'albero del componente che li apre. Il motivo è una
// regola del CSS che si paga cara: un elemento con `backdrop-filter` (o
// `filter`, o `transform`) diventa il RIFERIMENTO dei discendenti in
// `position: fixed`. Le cornici in vetro dell'app usano `backdrop-filter`,
// quindi una finestra `fixed inset-0` aperta dall'Explorer non copriva lo
// schermo: si ancorava all'Explorer, larga 255 px invece di 1280 (misurato).
//
// Portandola sul <body> il problema sparisce per costruzione, oggi e per
// qualsiasi cornice in vetro che verrà aggiunta domani.
export function Sovrapposizione({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
