import { Routes, Route } from 'react-router-dom';
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
      <Route path="/" element={<Dashboard />} />
      <Route path="/practice/new" element={<PracticeBuilder />} />
      <Route path="/test/new" element={<FullTestSetup />} />
      <Route path="/practice/:sessionId/q/:n" element={<Player />} />
      <Route path="/sessions/:sessionId" element={<SessionSummary />} />
      <Route path="/progress" element={<Progress />} />
      <Route path="/mistakes" element={<MistakeLog />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}

export default App;
