import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'RATE_LIMIT_SALT']) {
    if (environment[key]) process.env[key] = environment[key];
  }
  return {
    plugins: [react(), {
      name: 'local-santa-api',
      configureServer(server) {
        server.middlewares.use('/api/santa', async (request, response) => {
          try {
            const { default: handler } = await server.ssrLoadModule('/api/santa.js');
            await handler(request, response);
          } catch {
            response.writeHead(500, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ error: 'Lokální server se nepodařilo spustit.' }));
          }
        });
      },
    }],
  };
});
