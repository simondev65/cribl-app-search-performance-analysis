import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { TabNav, Text, Toast, type TabNavItemType } from '@capra/core';
import { BenchmarkProvider, useBenchmark } from './state/BenchmarkContext';
import { NewBenchmark } from './pages/NewBenchmark';
import { RunPage } from './pages/RunPage';
import { History } from './pages/History';
import { progressOf } from './lib/progress';

const TABS: TabNavItemType[] = [
  { key: 'new', name: 'New benchmark' },
  { key: 'runs', name: 'Runs' },
];

function Shell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { active } = useBenchmark();
  const running = active?.status === 'running';
  const progress = active ? progressOf(active) : null;

  return (
    <div className="spa-app">
      <header className="spa-header">
        <div className="spa-header__title">
          <Text as="h1" variant="heading-md">
            Search performance
          </Text>
          <Text variant="body-sm-normal" color="subtle">
            Same searches, same time windows, one at a time. See which dataset answers faster.
          </Text>
        </div>
        <TabNav
          items={TABS}
          activeKey={pathname.startsWith('/runs') ? 'runs' : 'new'}
          onTabPress={(key) => navigate(key === 'runs' ? '/runs' : '/')}
          aria-label="Sections"
          tabBarExtraSlot={
            running && active && progress ? (
              <button type="button" className="spa-live" onClick={() => navigate(`/runs/${active.id}`)}>
                <span className="spa-live__dot" aria-hidden />
                Running {progress.done} of {progress.total}
              </button>
            ) : undefined
          }
        />
      </header>
      <main className="spa-main">
        <Routes>
          <Route path="/" element={<NewBenchmark />} />
          <Route path="/runs" element={<History />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={window.CRIBL_BASE_PATH || '/'}>
      <BenchmarkProvider>
        <Shell />
        <Toast.Provider />
      </BenchmarkProvider>
    </BrowserRouter>
  );
}
