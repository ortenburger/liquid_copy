import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { WorkspaceShell } from "./pages/workspace/Shell";
import { OverviewPage } from "./pages/workspace/Overview";
import { CheckpointsPage } from "./pages/workspace/Checkpoints";
import { ExperimentsPage } from "./pages/workspace/Experiments";
import { KnowledgePage } from "./pages/workspace/Knowledge";
import { PlatformsPage } from "./pages/workspace/Platforms";
import { SettingsPage } from "./pages/workspace/Settings";
import { CarouselsPage } from "./pages/workspace/Carousels";
import { TestingPlanPage } from "./pages/workspace/TestingPlan";
import { InsightsPage } from "./pages/workspace/Insights";
import { TestPage } from "./pages/workspace/Test";
import { ChatPage } from "./pages/workspace/Chat";
import { useSimpleUi } from "./lib/hooks";

function WorkspaceHome() {
  const simpleUi = useSimpleUi();
  return simpleUi ? <ChatPage /> : <OverviewPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<WorkspaceShell />}>
          <Route index element={<WorkspaceHome />} />
          <Route path="checkpoints" element={<CheckpointsPage />} />
          <Route path="experiments" element={<ExperimentsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="platforms" element={<PlatformsPage />} />
          <Route path="carousels" element={<CarouselsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="testing-plan" element={<TestingPlanPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="test" element={<TestPage />} />
          <Route path="analytics" element={<Navigate to="/app" replace />} />
          <Route path="organization" element={<Navigate to="/app" replace />} />
          <Route path="approvals" element={<Navigate to="/app" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
