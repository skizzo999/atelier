import typography from '@tailwindcss/typography'

// I colori NON sono più scritti qui: sono variabili CSS definite in
// `src/index.css`, una volta per il tema chiaro e una per lo scuro. Tailwind
// compila una volta sola, quindi una palette scritta qui sarebbe fissa per
// sempre; con le variabili la stessa classe `bg-zinc-900` cambia significato
// a runtime e l'app intera passa da chiaro a scuro senza toccare un solo
// componente. I valori sono canali RGB separati da spazio: è la forma che
// serve a Tailwind per poter aggiungere la trasparenza (`bg-zinc-900/60`).
const conAlfa = (nome) => `rgb(var(${nome}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // L'app usa ovunque le classi zinc-*. Ogni gradino ha un RUOLO fisso
        // (sfondo, bordo, testo) che vale in entrambi i temi: 900 è la carta
        // su cui si legge, 100 è il testo principale, e così via.
        zinc: {
          950: conAlfa('--z-950'), // tinta dell'Explorer, la cornice più fonda
          900: conAlfa('--z-900'), // carta: documenti, griglia
          800: conAlfa('--z-800'), // pannelli, menu, bordi marcati
          700: conAlfa('--z-700'), // bordi, hover
          600: conAlfa('--z-600'), // separatori forti
          500: conAlfa('--z-500'), // testo attenuato
          400: conAlfa('--z-400'), // testo secondario
          300: conAlfa('--z-300'), // testo normale
          200: conAlfa('--z-200'), // testo marcato
          100: conAlfa('--z-100'), // TESTO principale
          50: conAlfa('--z-50'), // testo a contrasto massimo
        },
        // Accenti: azzurro → blu. Nello scuro schiariscono per restare vividi.
        accent: {
          DEFAULT: conAlfa('--acc'),
          2: conAlfa('--acc-2'),
          soft: 'rgb(var(--acc) / 0.10)',
          ink: conAlfa('--acc-ink'), // testo sui bottoni blu
        },
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', '"Times New Roman"', 'serif'],
      },
      borderRadius: {
        card: '18px', // le schede che "galleggiano" hanno angoli larghi
      },
      backdropBlur: {
        vetro: '30px',
      },
    },
  },
  plugins: [typography],
}
