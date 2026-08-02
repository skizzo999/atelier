# Roadmap di chiusura — Atelier v0.4.0

> Decisa con l'utente il 2026-07-17. Obiettivo: **finire il progetto**.
> Niente scope nuovo oltre a questa lista. Ogni fase: build verde + verifica
> reale prima di passare alla successiva.

## Scelte dell'utente (risposte esplicite)
- **Modalità Developer** = editor di codice **+** terminale integrato **+**
  git integrato **+** toolbox di utility (tutte e quattro).
- **Chiusura** = rifiniture e release **+** backlog Excel (grafici in
  lettura, validazione dati). Landing rimandata (non blocca la release).

## Stato di partenza
- pptx CHIUSO (viewer + Presenta con transizioni) — commit 89a0a73.
- Excel, md, docx, pdf, immagini completi. Guida it+en pubblicata.
- `mode: 'standard' | 'developer'` esiste già nello store, il toggle è nella
  titlebar ma **non fa nulla**: è il buco da riempire.

---

## D0 — Fondamenta: esecuzione comandi (abilita D2 e D3)
1. `tauri-plugin-shell` in `src-tauri/Cargo.toml` + registrazione in `lib.rs`.
2. `@tauri-apps/plugin-shell` nel package.json.
3. `capabilities/default.json`: `shell:allow-execute` con scope esplicito —
   `run-powershell` (Windows) e `run-sh` (macOS), `args: true`.
4. `src/lib/shell.ts`: `runCommand(cmd, cwd)` che sceglie l'interprete per
   piattaforma, cattura stdout/stderr/codice d'uscita, con timeout.
   ⚠ Modifiche a Rust/capabilities → serve riavvio completo di `tauri dev`.

## D1 — Editor di codice
- `CodeMirrorEditor`: numeri di riga, parentesi abbinate, **evidenziazione
  per linguaggio** dedotta dall'estensione (`@codemirror/language-data`,
  caricata pigra), **Ctrl+F** (`@codemirror/search`), rientro con Tab.
- `Editor.tsx` passa il nome file; i file di codice già finiscono qui.
- Vale in entrambe le modalità (non fa danno in Standard).

## D2 — Terminale integrato
- Pannello inferiore, visibile SOLO in modalità Developer.
- Prompt con la cartella corrente (parte dal vault), storico comandi
  (frecce ↑↓), output monospazio con stderr in rosso, Ctrl+L pulisci.
- `cd` gestito da noi (il processo è nuovo a ogni comando: la cwd la
  teniamo in stato, così il terminale "ricorda" dove sei).

## D3 — Git integrato
- Stessa area del terminale, scheda "Git".
- Ramo corrente + elenco file modificati (`git status --porcelain=v1 -b`),
  **diff** del file selezionato, **Aggiungi tutto → Commit → Push**.
- Se la cartella non è un repo: messaggio chiaro, niente errori grezzi.

## D4 — Toolbox utility
- Scheda "Strumenti": JSON (formatta/valida/minifica), tester di espressioni
  regolari (evidenzia le corrispondenze), diff fra due testi, encoder
  (base64, URL, hash SHA-256).
- Tutto lato client, nessuna dipendenza nuova.

## D5 — Backlog Excel
- **Grafici in lettura**: i grafici del file oggi non si vedono → mostrarli
  (lettura del chart XML, resa con un grafico nostro: barre/linee/torta).
- **Validazione dati**: celle con elenco → menu a tendina nella griglia,
  rispettando il vincolo in scrittura.

## D6 — Rifiniture e release v0.4.0
1. Passata finale: build, tsc, suite headless, prova a mano dell'utente.
2. Guida utente (it+en) aggiornata + PDF rigenerati.
3. Versioni allineate a 0.4.0 (package.json, tauri.conf.json, Cargo.toml,
   Cargo.lock), diario di sessione, CONTINUA_DOMANI.
4. Commit, tag `v0.4.0` → release automatica Win+macOS (GitHub Actions).

## Fuori scope (dichiarato)
Editor pptx, landing (og.png e FORM_ENDPOINT), qualsiasi feature non
elencata qui. Si riaprono solo su richiesta esplicita dell'utente.
