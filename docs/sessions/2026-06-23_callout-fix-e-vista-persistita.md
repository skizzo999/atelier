# Sessione 2026-06-23 - Fix callout Ibrida + vista persistita

## Obiettivo
Chiudere due rifiniture rimaste aperte sull'editor Markdown:
1. Il **callout** in vista Ibrida non combaciava con la Lettura.
2. L'app riapriva sempre in **Codice** invece dell'ultima vista scelta.

## 1. Callout Ibrida allineato alla Lettura
Stato iniziale: in Ibrida `> [!nota] ciao ciao` mostrava solo "CIAO CIAO" come
titolo (il testo dopo `[!nota]` veniva usato come titolo, perdendo sia il label
del tipo sia il corpo). La Lettura invece mostra `NOTA` (tipo) + `ciao ciao` (corpo).

Percorso di fix (con i relativi vicoli ciechi, utili da ricordare):
- 1° tentativo: titolo = tipo (NOTA) via widget a blocco, testo dopo lasciato come
  corpo → contenuto corretto, ma restava uno **spazio extra sopra "NOTA"**.
- 2° e 3° tentativo: ridurre la `line-height` (della riga, poi del widget) → si
  muoveva solo lo spazio **sotto** il titolo, mai quello sopra.
- **Causa reale**: ogni `Decoration.replace` con widget viene avvolto da CM6 in
  `cm-widgetBuffer` (span inline invisibili). Con un widget `display:block` quei
  buffer generano un line-box alto quanto la `line-height` della riga (1.9) →
  spazio "fantasma" sopra il titolo, non eliminabile via line-height.
- **Soluzione**: niente widget. Si nasconde `> [!tipo]` con un hide normale
  (zero-width, nessun buffer) e il titolo è uno pseudo-elemento `::before` della
  riga (`content: attr(data-callout)`, con `data-callout` = tipo maiuscolo messo
  come attributo dalla line decoration). Spaziatura sopra/sotto sotto controllo.
  Il `::before` viene aggiunto solo sulla riga non attiva (in modifica torna grezzo).
  Funziona sia su una riga (`> [!nota] testo`) sia su più righe.

## 2. Vista (Codice/Ibrida/Lettura) ricordata
- La vista era uno `useState` locale dell'Editor, per giunta resettato a `source`
  ad ogni cambio file.
- Spostata nello store come `mdView` (tipo `MarkdownView`), con setter `setMdView`
  e inclusa nel `partialize` di `zustand/persist` (insieme a vaultPath + mode).
- Tolto il `setView('source')` all'apertura del file. Rimosso il tipo locale
  `ViewMode` (ora inutilizzato).

## File toccati
- src/components/CodeMirror/livePreview.ts (callout via ::before, rimosso CalloutTitleWidget)
- src/store/appStore.ts (mdView + setMdView + partialize)
- src/components/Editor/Editor.tsx (vista dallo store, niente reset a source)

## Regola da ricordare
I `cm-widgetBuffer` di CM6 attorno ai widget occupano un line-box pari alla
line-height della riga: per i "titoli a blocco" preferire un `::before` (CSS) al
widget, così non si paga lo spazio fantasma.

## Stato
Editor Markdown completo e rifinito. Verificati `tsc --noEmit` e `vite build` (ok).
Prossimo step invariato: annotazioni immagini (fase 2).
