import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { PracticeBuilder } from './pages/PracticeBuilder';
import { FullTestSetup } from './pages/FullTestSetup';
import { Player } from './pages/Player';
import { SessionSummary } from './pages/SessionSummary';
import { Progress } from './pages/Progress';
import { MistakeLog } from './pages/MistakeLog';
import { Settings } from './pages/Settings';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/practice/new"
        element={
          <RequireAuth>
            <PracticeBuilder />
          </RequireAuth>
        }
      />
      <Route
        path="/test/new"
        element={
          <RequireAuth>
            <FullTestSetup />
          </RequireAuth>
        }
      />
      <Route
        path="/practice/:sessionId/q/:n"
        element={
          <RequireAuth>
            <Player />
          </RequireAuth>
        }
      />
      <Route
        path="/sessions/:sessionId"
        element={
          <RequireAuth>
            <SessionSummary />
          </RequireAuth>
        }
      />
      <Route
        path="/progress"
        element={
          <RequireAuth>
            <Progress />
          </RequireAuth>
        }
      />
      <Route
        path="/mistakes"
        element={
          <RequireAuth>
            <MistakeLog />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
