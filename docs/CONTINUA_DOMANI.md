# Prossimi step - Continuità

> Aggiornato al 2026-07-03, pomeriggio (si riprende STASERA). Dettaglio funzioni
> in `docs/STATUS.md`; piano Office in `docs/PIANO_OFFICE.md`.

## ⚡ Ripresa rapida (aggiornata 2026-07-08)
**Direzione dichiarata dall'utente: "ricreare interamente Excel dentro
Atelier"**. Excel = viewer fedele + editor + funzioni pro (9e) + **drop 1
di Excel-completo** (9f): **motore formule vero** (fast-formula-parser MIT,
~280 funzioni, ricalcolo live, alias italiani =SOMMA/=SE, `$` bloccati nel
fill), **barra della formula** (nome + fx), **Formato celle** (bordi per
lato/stile/colore + gradiente), **stili tabella predefiniti**, ordinamento
numerico. In più (2026-07-08, feedback utente): **modalità formula COMPLETA** (click
su una cella inserisce il riferimento, drag = range, ogni riferimento
COLORATO come Excel: riquadro tratteggiato sulla cella + testo dello stesso
colore nella formula), **fix allineamento** dell'overlay (celle e numero di
riga ad altezza fissa = geometria sempre uguale al modello, auto-fit riga
al font), **rowSpan vero** per le unioni verticali + **banner che
debordano** (titolo 42pt di "Pro e contro" era tagliato) e **fix clamp dei
range** (rowCount vs actualRowCount sui fogli sparsi). Terzo giro:
**auto-fit delle righe al contenuto come Google** (i template esportano
altezze stantie: banner in righe da 6pt — fix del glyph soup di Orario
settimanale e del titolo sovrapposto in Pro e contro) e **fill handle
visibile anche mentre scrivi** (il drag committa e poi riempie), **mini-menu
del tasto Canc** (Solo contenuto / Solo formattazione / Tutto; Backspace =
contenuto diretto). Tutto riprodotto e verificato in un harness browser col
componente VERO (0 righe fuori modello su Pro e contro e Orario, delta
overlay 0.00). L'utente ha detto "funziona tutto" su tutto il resto.
**2026-07-09 — ULTIMO MIGLIO fatto (sezione 9h, da testare)**: tastiera
completa (frecce/Invio scende/Tab/Ctrl+frecce/F2/scrivi-per-sostituire —
⚠ il click ora SELEZIONA come Excel, si edita scrivendo, con F2 o doppio
click), copia/incolla ricco (formule traslate + stili; Taglia svuota
l'origine all'incolla, un solo Ctrl+Z), blocca riquadri (round-trip nel
file + menu tasto destro), doppio click sul bordo colonna = auto-adatta.
**2026-07-09 sera — giro "SPAESAMENTO" fatto (9i, da testare)**: date/orari/
percentuali digitati riconosciuti, barra di stato Somma/Media/Conteggio,
autocompletamento formule (=SO → SOMMA…), F4 cicla i $, Ctrl+D/R, doppio
click sul fill handle, Shift+click, selezione multipla dalle intestazioni,
Ctrl+F trova nel foglio, e **formule traslate su inserimento/eliminazione
righe-colonne** (il buco di correttezza, chiuso con semantica Excel piena).
Release v0.3.0: la decide l'utente dopo il test di 9h+9i.
Tutto in sezione 9e-9i di PIANO_OFFICE.md; build verde, 78 test
headless, **da testare a mano, NON ancora committato**. Prossimi:
1. L'utente testa 9e+9f → fix → commit quando lo dice lui.
2. **Backlog Excel-completo da prioritizzare con lui** (fine di 9f in
   PIANO_OFFICE.md): blocca riquadri, formati numero/date, unione celle da
   UI, trova e sostituisci, validazione dati, formule su insert/delete,
   grafici (Fase 15), CF dopo ogni edit.
3. **Blocco presentazioni**: tasto **Presenta** (fullscreen, frecce, Esc) +
   **editor slide** — PRIMA fare ricerca librerie (regola reuse-first:
   Fabric.js/Konva per canvas editing vs DOM nostro; confronto da portare
   all'utente)
4. Release quando lo dice lui.

---

## Dove siamo arrivati

- **Release pubblicate**: v0.2.0 (tabelle Obsidian in Ibrida + menu contestuale md),
  v0.2.1 (Cestino + igiene audit), v0.2.2 (DPI immagini, backup PDF, worker OCR, scope).
  Il tag `v*` builda Win+macOS e pubblica la Release in automatico (GitHub Actions).
- **Ultimo blocco (committato, NON ancora rilasciato)**: **sistema vault "vero" stile
  Obsidian** — `.atelier\vault.json` dentro ogni vault, **picker** all'avvio (lista vault
  conosciuti + Crea/Apri), picker anche quando apri una **seconda istanza** (heartbeat
  in localStorage). Testato dall'utente ✓.
- **Audit codice**: 19/24 voci chiuse (ultimi: PERF-1 code-split, bundle 3.5MB→490kB,
  e BUG-5 indici live). Il file vive in
  `C:\Users\matte\Documents\Obsidian Vault\Atelier-analisi-codice.md` (fuori dal repo);
  le 6 aperte sono mappate a fasi future nella sezione "Voci ancora aperte" del file.
- Editor completi: Markdown (3 viste, tabelle vere editabili in Ibrida), DOCX (pagine A4
  vere, legge anche i .docx esterni), PDF (evidenziatore con .bak), immagini (annotazioni,
  DPI preservato). File: drag-drop nel tree, import da Explorer, modale "Nuovo file",
  eliminazione nel Cestino.

## Cosa fare (in ordine)

1. ~~Ultimi fix~~ ✅ fatti (PERF-1 code-split + BUG-5 indici, sera del 2026-07-02).
   **Da testare a runtime**: apertura di md/PDF/DOCX/immagini dopo il code-split
   (spinner alla 1ª apertura per tipo), OCR, creazione .docx, ricerca nei PDF/DOCX.
2. **Prossima release ("la .3")**: la decide l'utente, quando ha testato.
3. **Direzione v0.3.0 DECISA: pacchetto Office (xlsx+pptx)** → scaletta completa,
   librerie e licenze verificate in **`docs/PIANO_OFFICE.md`** (partire dalla Fase 0,
   lo spike SheetJS vs ExcelJS). Le alternative scartate per ora erano:
   - **Excel/PPT** ← raccomandata (completa l'identità "apri qualsiasi file di lavoro");
     reality check già dato: xlsx viewer fattibile (SheetJS), xlsx editor = progetto
     grosso a tappe, pptx = viewer best-effort (nessun renderer OSS maturo)
   - **Modalità developer** — il toggle esiste ma è vuoto: va DEFINITA prima (10 min di
     chiacchierata su cosa deve contenere)
   - **Parte grafica** — per ultima, come ha sempre detto l'utente; include: token
     colore/tema unificato, **dialog chiusura custom** (il confirm nativo non gli
     piace), code-split del bundle (PERF-1)
4. **Rifiniture Ibrida** (dopo, insieme alle rifiniture base): liste numerate/annidate,
   footnote, KaTeX, md inline renderizzato nelle celle tabella.

## Note operative
- Commit/push SOLO quando l'utente lo chiede; messaggi in italiano, chiusi da
  `Co-Authored-By: Claude <modello> <noreply@anthropic.com>`.
- L'utente testa a mano prima di ogni release; le modifiche Rust/config richiedono
  riavvio di `pnpm tauri dev` (il reload Vite non basta).
- Se si apre lo stesso vault in due finestre non c'è lock (Obsidian lo impedisce, noi
  no): eventuale rifinitura futura.
