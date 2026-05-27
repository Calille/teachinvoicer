import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConnectionStatus } from '../../shared/types';

type EnvInfo = {
  envPath: string | null;
  expectedPath: string;
  hasCredentials: boolean;
};

export default function Setup(): JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const [s, env] = await Promise.all([
        window.api.xero.status(),
        window.api.app.envInfo(),
      ]);
      setStatus(s);
      setEnvInfo(env);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleConnect = async (): Promise<void> => {
    setConnecting(true);
    setError(null);
    try {
      const s = await window.api.xero.connect();
      setStatus(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    await window.api.xero.disconnect();
    await refresh();
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Welcome</h1>
        <p className="mt-1 text-sm text-slate-600">
          Connect your Xero account once. Tokens are stored locally and refreshed automatically.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold text-slate-900">Xero connection</h2>
          {status?.connected && <span className="badge-green">Connected</span>}
        </div>
        <div className="p-6">
          {status === null && <div className="text-sm text-slate-500">Checking…</div>}

          {status && !status.connected && (
            <div className="space-y-4">
              {envInfo && !envInfo.hasCredentials && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="mb-1 font-semibold">Xero credentials not found</div>
                  <p className="mb-2">
                    Create a file called <code className="font-mono">.env</code> at the path below
                    with your Xero developer client ID and secret, then restart the app.
                  </p>
                  <pre className="overflow-x-auto rounded bg-white/70 p-2 font-mono text-[11px] leading-snug text-slate-800">
{envInfo.expectedPath}{`

XERO_CLIENT_ID=...
XERO_CLIENT_SECRET=...
XERO_REDIRECT_PORT=5391`}
                  </pre>
                </div>
              )}
              {envInfo?.envPath && (
                <p className="text-xs text-slate-500">
                  Loaded credentials from{' '}
                  <code className="font-mono">{envInfo.envPath}</code>
                </p>
              )}
              <p className="text-sm text-slate-600">
                You'll be sent to Xero in your browser to authorise this app. After approving,
                you'll be redirected back automatically.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting || (envInfo !== null && !envInfo.hasCredentials)}
                className="btn-primary"
              >
                {connecting ? 'Waiting for authorisation…' : 'Connect to Xero'}
              </button>
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>
          )}

          {status?.connected && (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-slate-500">Organisation</dt>
                <dd className="font-medium text-slate-900">{status.tenantName}</dd>
                <dt className="text-slate-500">Tenant ID</dt>
                <dd className="font-mono text-xs text-slate-600">{status.tenantId}</dd>
                <dt className="text-slate-500">Token expires</dt>
                <dd className="text-slate-700">
                  {new Date(status.expiresAt).toLocaleString('en-GB')}
                </dd>
              </dl>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => navigate('/upload')}
                  className="btn-primary"
                >
                  Continue to upload
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="btn-secondary"
                >
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
