import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "@/auth/useAuth";
import type { Capability } from "@/auth/permissions";
import { Layout } from "@/components/Layout";
import { LoadingState } from "@/components/common";
import { ResolveGuard } from "@/components/resolve-guard";

const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Assessments = lazy(() => import("@/pages/Assessments"));
const NewAssessment = lazy(() => import("@/pages/NewAssessment"));
const AssessmentDetail = lazy(() => import("@/pages/AssessmentDetail"));
const TestDetail = lazy(() => import("@/pages/TestDetail"));
const ManualTestSteps = lazy(() => import("@/pages/ManualTestSteps"));
const RunDetail = lazy(() => import("@/pages/RunDetail"));
const Findings = lazy(() => import("@/pages/Findings"));
const FindingDetail = lazy(() => import("@/pages/FindingDetail"));
const Tickets = lazy(() => import("@/pages/Tickets"));
const TicketDetail = lazy(() => import("@/pages/TicketDetail"));
const Resolve = lazy(() => import("@/pages/Resolve"));
const ResolveApplication = lazy(() => import("@/pages/ResolveApplication"));
const ResolveTicket = lazy(() => import("@/pages/ResolveTicket"));
const ControlDetail = lazy(() => import("@/pages/ControlDetail"));
const ControlPreview = lazy(() => import("@/pages/ControlPreview"));
const Settings = lazy(() => import("@/pages/Settings"));
const Admin = lazy(() => import("@/pages/Admin"));
const Learn = lazy(() => import("@/pages/Learn"));

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
    <Suspense fallback={<LoadingState label="Loading…" />}>
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
            path="findings/:findingId/controls/:controlId"
            element={
              <RequireCapability capability="view_findings">
                <ControlPreview />
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
          <Route
            path="tickets/:ticketId/controls/:controlId"
            element={
              <RequireCapability capability="view_tickets">
                <ControlDetail />
              </RequireCapability>
            }
          />

          <Route
            path="resolve"
            element={
              <ResolveGuard>
                <Resolve />
              </ResolveGuard>
            }
          />
          <Route
            path="resolve/applications/:applicationId"
            element={
              <ResolveGuard>
                <ResolveApplication />
              </ResolveGuard>
            }
          />
          <Route
            path="resolve/findings/:findingId/controls/:controlId"
            element={
              <ResolveGuard>
                <ControlPreview />
              </ResolveGuard>
            }
          />
          <Route
            path="resolve/tickets/:ticketId"
            element={
              <ResolveGuard>
                <ResolveTicket />
              </ResolveGuard>
            }
          />
          <Route
            path="resolve/tickets/:ticketId/controls/:controlId"
            element={
              <ResolveGuard>
                <ControlDetail />
              </ResolveGuard>
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
    </Suspense>
  );
}
