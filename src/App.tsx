import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import Layout from './components/Layout';
import { RunProvider } from './lib/RunContext';
import Setup from './screens/Setup';
import Upload from './screens/Upload';
import Parse from './screens/Parse';
import Match from './screens/Match';
import Review from './screens/Review';
import Results from './screens/Results';
import Settings from './screens/Settings';

function MenuShortcuts(): null {
  const navigate = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const off1 = window.api.events.onMenu('menu:open-file', () => navigate('/upload'));
    const off2 = window.api.events.onMenu('menu:open-settings', () => navigate('/settings'));
    return () => {
      off1();
      off2();
    };
  }, [navigate]);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && loc.pathname !== '/' && loc.pathname !== '/setup') {
        navigate(-1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [loc.pathname, navigate]);

  return null;
}

export default function App(): JSX.Element {
  return (
    <RunProvider>
      <MenuShortcuts />
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/parse" element={<Parse />} />
          <Route path="/match" element={<Match />} />
          <Route path="/review" element={<Review />} />
          <Route path="/results" element={<Results />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </Routes>
      </Layout>
    </RunProvider>
  );
}
