import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ConnectionStatus } from '../../shared/types';

export default function Setup(): JSX.Element {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const s = await window.api.xero.status();
      setStatus(s);
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
              <p className="text-sm text-slate-600">
                You'll be sent to Xero in your browser to authorise this app. After approving,
                you'll be redirected back automatically.
              </p>
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
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
