import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Tema freddo "grigio · bianco · azzurro · blu" (scelta utente,
        // 2026-07-11). L'app usa ovunque le classi zinc-*: rimappare la
        // scala qui cambia tutta l'interfaccia in un colpo solo.
        // Base: slate di Tailwind (grigi con una punta di blu, non "morti").
        zinc: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#0a1020',
        },
        // blue/emerald restano i DEFAULT di Tailwind (vividi): i bottoni
        // fondamentali usano .btn-accent (gradiente azzurro→blu) e si
        // staccano da quelli grigi secondari.
        accent: {
          DEFAULT: '#3b82f6',
          2: '#38bdf8',
          soft: 'rgba(59, 130, 246, 0.12)',
          ink: '#ffffff', // testo sui bottoni blu
        },
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', '"Times New Roman"', 'serif'],
      },
      borderRadius: {
        card: '14px',
      },
    },
  },
  plugins: [typography],
}
