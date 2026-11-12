/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Dev: forward API calls so cookies stay same-origin (SameSite=Strict works).
    proxy: { '/api': 'http://localhost:3000' },
  },
  // Pre-bundle every Tiptap entry point up front. A late discovery makes Vite re-bundle
  // mid-session, which can load two copies of React ("Invalid hook call").
  optimizeDeps: {
    include: ['@tiptap/react', '@tiptap/react/menus', '@tiptap/extension-table', '@tiptap/extensions', '@tiptap/pm/state'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
