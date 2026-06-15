import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        status: {
          planned: '#9CA3AF',
          inprogress: '#3B82F6',
          aicompleted: '#A855F7',
          needsuser: '#EAB308',
          verified: '#22C55E',
          broken: '#EF4444',
          archived: '#6B7280',
        },
      },
    },
  },
  plugins: [],
};

export default config;
