import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tema "vetro" chiaro — bianco · azzurro · blu (scelta utente,
        // 2026-08-30, bozza 3).
        //
        // L'app usa ovunque le classi zinc-*: rimappare QUI la scala cambia
        // tutta l'interfaccia in un colpo solo. La scala è ROVESCIATA
        // rispetto al tema scuro precedente — zinc-900 era lo sfondo più
        // scuro e ora è la superficie più chiara, zinc-100 era il testo
        // chiaro e ora è il testo scuro — così ogni classe già scritta
        // mantiene il suo RUOLO (sfondo, bordo, testo) senza toccarla.
        zinc: {
          950: '#e6eefb', // era lo sfondo più scuro (Explorer) → tinta azzurrina
          900: '#ffffff', // era lo sfondo app → carta bianca
          800: '#e2eaf6', // pannelli, menu, bordi marcati
          700: '#ccd9ec', // bordi, hover
          600: '#a6b6cd', // separatori forti
          500: '#7b8aa3', // testo attenuato
          400: '#5c6a82', // testo secondario
          300: '#3f4a5c', // testo normale
          200: '#2a3442', // testo marcato
          100: '#16202e', // TESTO principale
          50: '#0b1220', // testo massimo contrasto
        },
        // Accenti: azzurro → blu. Restano vividi su fondo chiaro.
        accent: {
          DEFAULT: '#2b6ef5',
          2: '#5cc6f8',
          soft: 'rgba(43, 110, 245, 0.10)',
          ink: '#ffffff', // testo sui bottoni blu
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
