import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider";
import type { Capability } from "@/auth/permissions";
import { Layout } from "@/components/Layout";
import { LoadingState } from "@/components/common";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Assessments from "@/pages/Assessments";
import NewAssessment from "@/pages/NewAssessment";
import AssessmentDetail from "@/pages/AssessmentDetail";
import TestDetail from "@/pages/TestDetail";
import ManualTestSteps from "@/pages/ManualTestSteps";
import RunDetail from "@/pages/RunDetail";
import Findings from "@/pages/Findings";
import FindingDetail from "@/pages/FindingDetail";
import Tickets from "@/pages/Tickets";
import TicketDetail from "@/pages/TicketDetail";
import Settings from "@/pages/Settings";
import Admin from "@/pages/Admin";
import Learn from "@/pages/Learn";

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <LoadingState label="Loading…" />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireCapability({
  capability,
  children,
}: {
  capability: Capability;
  children: ReactNode;
}) {
  const { can } = useAuth();
  if (!can(capability)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />

        <Route
          path="assessments"
          element={
            <RequireCapability capability="view_assessments">
              <Assessments />
            </RequireCapability>
          }
        />
        <Route
          path="assessments/new"
          element={
            <RequireCapability capability="run_test">
              <NewAssessment />
            </RequireCapability>
          }
        />
        <Route
          path="assessments/:assessmentId"
          element={
            <RequireCapability capability="view_assessments">
              <AssessmentDetail />
            </RequireCapability>
          }
        />
        <Route
          path="assessments/:assessmentId/tests/:testId"
          element={
            <RequireCapability capability="view_assessments">
              <TestDetail />
            </RequireCapability>
          }
        />
        <Route
          path="assessments/:assessmentId/tests/:testId/runs/:runId"
          element={
            <RequireCapability capability="view_assessments">
              <TestDetail />
            </RequireCapability>
          }
        />
        <Route
          path="assessments/:assessmentId/tests/:testId/manual"
          element={
            <RequireCapability capability="view_assessments">
              <ManualTestSteps />
            </RequireCapability>
          }
        />
        <Route
          path="runs/:runTimestamp"
          element={
            <RequireCapability capability="view_assessments">
              <RunDetail />
            </RequireCapability>
          }
        />

        <Route
          path="findings"
          element={
            <RequireCapability capability="view_findings">
              <Findings />
            </RequireCapability>
          }
        />
        <Route
          path="findings/:findingId"
          element={
            <RequireCapability capability="view_findings">
              <FindingDetail />
            </RequireCapability>
          }
        />

        <Route
          path="tickets"
          element={
            <RequireCapability capability="view_tickets">
              <Tickets />
            </RequireCapability>
          }
        />
        <Route
          path="tickets/:ticketId"
          element={
            <RequireCapability capability="view_tickets">
              <TicketDetail />
            </RequireCapability>
          }
        />

        <Route path="settings" element={<Settings />} />
        <Route path="learn" element={<Learn />} />
        <Route
          path="admin"
          element={
            <RequireCapability capability="access_admin">
              <Admin />
            </RequireCapability>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
