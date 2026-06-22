# Sessione 2026-06-22 (5) - Ricerca / quick-open

## Obiettivo
Ricerca e quick-open dei file, coerente con la visione multi-formato:
l'indice deve coprire TUTTI i tipi di file, non solo i markdown.

## Cosa è stato fatto
- src/lib/search.ts:
  - `walkFiles`: elenco ricorsivo di tutti i file del vault (type-agnostic).
  - `searchContent`: ricerca nel contenuto dei file testuali (una riga per file).
  - `rankByName`: ordinamento risultati per nome.
- src/components/SearchPalette/SearchPalette.tsx: pannello con due tab.
  - **Ctrl+P** → quick-open per nome (qualsiasi tipo di file), filtro istantaneo.
  - **Ctrl+Shift+F** → ricerca nel contenuto (file testuali; i binari verranno
    inclusi quando avranno viewer/estrattori).
  - Navigazione da tastiera (↑↓, Invio, Esc) e click.
- Highlight: aprendo un risultato di ricerca-contenuto, l'editor seleziona e
  scrolla alla prima occorrenza del termine (store `pendingHighlight`, one-shot).

## Visione multi-formato (promemoria esplicito dell'utente)
- Deve gestire TUTTI i tipi di file: md, txt, docx, pdf, svg, png, jpeg, pptx,
  xlsx e altri. Non tutto subito, ma è l'obiettivo.
- I file di codice si legano alla futura modalità developer.
- Prossimo grande pezzo allineato: **routing dei viewer per tipo** (oggi qualsiasi
  file viene aperto come testo).

## Note tecniche
- Nessuna nuova dipendenza/permesso.
- La ricerca-contenuto rilegge i file a ogni query: ok per vault medi,
  ottimizzabile con un indice mantenuto dal watcher.
