import { BrowserWindow, ipcMain, shell } from 'electron';
import express from 'express';
import type { Express, Request, Response } from 'express';
import type { Server } from 'node:http';
import { XeroClient } from 'xero-node';
import { getStore, getXeroTokens, setXeroTokens } from '../store/index';
import type { ConnectionStatus } from '../../shared/types';

// Xero deprecated the broad "accounting.transactions" scope on 2 March 2026.
// Apps created after that date only support the granular replacements
// (accounting.invoices, accounting.payments, accounting.banktransactions, …).
// We only need accounting.invoices to create ACCREC invoices.
const SCOPES = [
  'openid',
  'profile',
  'email',
  'accounting.contacts.read',
  'accounting.invoices',
  'accounting.settings.read',
  'offline_access',
];

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if expiring within 5 minutes

let activeClient: XeroClient | null = null;
let authServer: Server | null = null;
let authServerPort = 5391;
let cachedClientFingerprint = '';

function envOr(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(
    `Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`,
  );
}

function getRedirectUri(): string {
  return `http://localhost:${authServerPort}/callback`;
}

function getClientFingerprint(): string {
  return `${envOr('XERO_CLIENT_ID')}|${envOr('XERO_CLIENT_SECRET')}|${getRedirectUri()}`;
}

function buildClient(): XeroClient {
  return new XeroClient({
    clientId: envOr('XERO_CLIENT_ID'),
    clientSecret: envOr('XERO_CLIENT_SECRET'),
    redirectUris: [getRedirectUri()],
    scopes: SCOPES,
    httpTimeout: 30_000,
  });
}

/**
 * Returns an initialized XeroClient with a valid (refreshed if needed)
 * token set and a populated tenants array. Throws if not connected.
 */
export async function getXeroClient(): Promise<{
  client: XeroClient;
  tenantId: string;
  tenantName: string;
}> {
  const tokens = getXeroTokens();
  if (!tokens) {
    throw new Error('Not connected to Xero. Open the app and click Connect to Xero.');
  }

  const fingerprint = getClientFingerprint();
  if (!activeClient || cachedClientFingerprint !== fingerprint) {
    activeClient = buildClient();
    cachedClientFingerprint = fingerprint;
    await activeClient.initialize();
  }

  activeClient.setTokenSet({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: Math.floor(tokens.tokenExpiresAt / 1000),
    token_type: 'Bearer',
    scope: SCOPES.join(' '),
  });

  const now = Date.now();
  if (tokens.tokenExpiresAt - now < REFRESH_BUFFER_MS) {
    try {
      const newSet = await activeClient.refreshToken();
      persistTokenSet(newSet, tokens.tenantId, tokens.tenantName);
    } catch (err) {
      // Refresh failed — token likely revoked. Clear and throw.
      setXeroTokens(null);
      throw new Error(
        'Xero refresh token rejected. Please reconnect to Xero (Setup screen).',
      );
    }
  }

  // Make sure the tenants array is populated so subsequent API calls have it.
  if (!activeClient.tenants || activeClient.tenants.length === 0) {
    try {
      await activeClient.updateTenants(false);
    } catch {
      // Non-fatal; we still have tenantId from storage.
    }
  }

  return {
    client: activeClient,
    tenantId: tokens.tenantId,
    tenantName: tokens.tenantName,
  };
}

function persistTokenSet(
  tokenSet: { access_token?: string; refresh_token?: string; expires_at?: number },
  tenantId: string,
  tenantName: string,
): void {
  if (!tokenSet.access_token || !tokenSet.refresh_token || !tokenSet.expires_at) {
    throw new Error('Xero returned an incomplete token set.');
  }
  setXeroTokens({
    accessToken: tokenSet.access_token,
    refreshToken: tokenSet.refresh_token,
    tokenExpiresAt: tokenSet.expires_at * 1000,
    tenantId,
    tenantName,
  });
}

// ---------------------------------------------------------------------------
// Express callback server (started only during the connect flow)
// ---------------------------------------------------------------------------

function successPage(orgName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Connected</title>
<style>
  body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; background: #f8fafc; color: #0f172a; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { background:#fff; border-radius:12px; padding:32px 40px; box-shadow:0 1px 3px rgba(15,23,42,0.08); max-width:480px; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 8px; }
  p { color:#475569; font-size:0.9rem; margin:8px 0; }
  .tick { color:#16a34a; font-size:2rem; }
</style></head>
<body><div class="card">
  <div class="tick">&#10003;</div>
  <h1>Connected to ${escapeHtml(orgName)}</h1>
  <p>You can close this tab and return to the Xero Invoicer app.</p>
</div></body></html>`;
}

function errorPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Connection failed</title>
<style>
  body { font-family: -apple-system, system-ui, Segoe UI, Roboto, sans-serif; background: #f8fafc; color: #0f172a; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
  .card { background:#fff; border-radius:12px; padding:32px 40px; box-shadow:0 1px 3px rgba(15,23,42,0.08); max-width:520px; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 8px; color:#b91c1c; }
  p { color:#475569; font-size:0.9rem; margin:8px 0; }
</style></head>
<body><div class="card">
  <h1>Could not connect</h1>
  <p>${escapeHtml(message)}</p>
  <p>Please return to the Xero Invoicer app and try again.</p>
</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function ensurePort(): number {
  const envPort = process.env['XERO_REDIRECT_PORT'];
  const n = envPort ? parseInt(envPort, 10) : 5391;
  if (!Number.isFinite(n) || n < 1024 || n > 65535) return 5391;
  return n;
}

async function startAuthServer(
  handler: (req: Request, res: Response) => Promise<void>,
): Promise<void> {
  if (authServer) return;
  authServerPort = ensurePort();
  const app: Express = express();
  app.get('/callback', (req, res) => {
    void handler(req, res);
  });
  app.get('/', (_req, res) => {
    res.send('Xero Invoicer callback server is running. Waiting for authorisation…');
  });
  await new Promise<void>((resolve, reject) => {
    authServer = app.listen(authServerPort, '127.0.0.1', () => resolve());
    authServer?.on('error', (e) => reject(e));
  });
}

export function shutdownAuthServer(): void {
  if (authServer) {
    authServer.close();
    authServer = null;
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function statusFromTokens(): ConnectionStatus {
  const t = getXeroTokens();
  if (!t) return { connected: false };
  return {
    connected: true,
    tenantId: t.tenantId,
    tenantName: t.tenantName,
    expiresAt: t.tokenExpiresAt,
  };
}

export function registerXeroIpc(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('xero:status', () => statusFromTokens());

  ipcMain.handle('xero:disconnect', async () => {
    try {
      if (activeClient) {
        try {
          await activeClient.revokeToken();
        } catch {
          // ignore — revoke is best-effort
        }
      }
    } finally {
      setXeroTokens(null);
      activeClient = null;
    }
  });

  ipcMain.handle('xero:connect', async (): Promise<ConnectionStatus> => {
    // Build a fresh client + start callback server, drive consent in browser.
    if (!process.env['XERO_CLIENT_ID'] || !process.env['XERO_CLIENT_SECRET']) {
      throw new Error(
        'Xero developer credentials are not configured. Create .env from .env.example with XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
      );
    }

    authServerPort = ensurePort();
    const client = buildClient();
    await client.initialize();

    const result = await new Promise<ConnectionStatus>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void, isResolve: boolean, payload?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        shutdownAuthServer();
        if (isResolve) {
          resolve(payload as ConnectionStatus);
        } else {
          reject(payload as Error);
        }
        fn();
      };

      const timer = setTimeout(
        () => {
          settle(
            () => undefined,
            false,
            new Error('Timed out waiting for Xero authorisation (5 minutes).'),
          );
        },
        5 * 60 * 1000,
      );

      startAuthServer(async (req, res) => {
        try {
          // Express's req.url for the /callback route is something like
          // "/callback?code=…&state=…". xero-node's apiCallback wants the full
          // URL including our registered redirect URI.
          const qIdx = (req.url ?? '').indexOf('?');
          const query = qIdx >= 0 ? (req.url ?? '').slice(qIdx) : '';
          const fullUrl = `${getRedirectUri()}${query}`;
          const tokenSet = await client.apiCallback(fullUrl);
          await client.updateTenants(false);
          const tenant = client.tenants?.[0];
          if (!tenant?.tenantId) {
            throw new Error(
              'Connected to Xero, but no organisation is linked to this app. Add an organisation in your Xero developer account and try again.',
            );
          }
          persistTokenSet(
            tokenSet as { access_token?: string; refresh_token?: string; expires_at?: number },
            tenant.tenantId,
            tenant.tenantName ?? 'Xero organisation',
          );
          activeClient = client;
          cachedClientFingerprint = getClientFingerprint();
          res.status(200).send(successPage(tenant.tenantName ?? 'Xero organisation'));

          // Focus the main window so Josh can carry on without alt-tab.
          const win = getMainWindow();
          if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
          }
          settle(() => undefined, true, statusFromTokens());
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          res.status(400).send(errorPage(msg));
          settle(() => undefined, false, e instanceof Error ? e : new Error(msg));
        }
      })
        .then(async () => {
          const url = await client.buildConsentUrl();
          await shell.openExternal(url);
        })
        .catch((err) => {
          settle(
            () => undefined,
            false,
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    });

    return result;
  });

  // Keep a no-op reference so getStore() initialises early (decrypts on first read).
  ipcMain.on('store:warm', () => {
    void getStore();
  });
}
