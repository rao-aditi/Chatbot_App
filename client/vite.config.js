import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { brokerAdminToken } from './api/admin-token.js';

// Serves /api/admin-token during `vite dev` the same way the Vercel function
// does in production. Env is read server-side only (all prefixes), so
// ADMIN_DASHBOARD_KEY never enters the client bundle.
function adminTokenDevPlugin(env) {
  return {
    name: 'admin-token-dev',
    configureServer(server) {
      server.middlewares.use('/api/admin-token', async (req, res) => {
        const { status, body } = await brokerAdminToken(req, env);
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), adminTokenDevPlugin(env)],
    server: {
      port: 3000,
      open: true,
    },
  };
});
