import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Landing } from "./pages/Landing";
import { WorkspaceShell } from "./pages/workspace/Shell";
import { OverviewPage } from "./pages/workspace/Overview";
import { CheckpointsPage } from "./pages/workspace/Checkpoints";
import { ExperimentsPage } from "./pages/workspace/Experiments";
import { KnowledgePage } from "./pages/workspace/Knowledge";
import { PlatformsPage } from "./pages/workspace/Platforms";
import { SettingsPage } from "./pages/workspace/Settings";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<WorkspaceShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="checkpoints" element={<CheckpointsPage />} />
          <Route path="experiments" element={<ExperimentsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="platforms" element={<PlatformsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
