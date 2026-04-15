import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#dbe6ff',
          200: '#bdd0ff',
          300: '#93b0ff',
          400: '#6886ff',
          500: '#4861ff',
          600: '#2f3df5',
          700: '#2830d8',
          800: '#252caf',
          900: '#242b8a',
        },
        ink: {
          900: '#0b1020',
          700: '#2a3142',
          500: '#5b6478',
          300: '#aab1c0',
          100: '#e6e9f0',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Noto Sans',
          'Noto Sans SC',
          'Noto Sans TC',
          'Noto Sans JP',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        soft: '0 10px 30px -12px rgba(11, 16, 32, 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
