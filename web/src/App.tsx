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
import { Contact } from './pages/Contact';
import { Help } from './pages/Help';
import { Terms } from './pages/Terms';
import { Privacy } from './pages/Privacy';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
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
      <Route
        path="/contact"
        element={
          <RequireAuth>
            <Contact />
          </RequireAuth>
        }
      />
      <Route
        path="/help"
        element={
          <RequireAuth>
            <Help />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default App;
