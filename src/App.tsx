import { Navigate, Route, Routes } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "@/auth/useAuth";
import { defaultRouteFor, type Capability } from "@/auth/permissions";
import { Layout } from "@/components/Layout";
import { ErrorState, LoadingState } from "@/components/common";
import { ResolveGuard } from "@/components/resolve-guard";
import {
  LegacyFindingRedirect,
  LegacyListRedirect,
  LegacyTicketRedirect,
} from "@/pages/LegacyRedirect";
// The two landing pages load eagerly: they are where nearly every session
// starts, so a chunk fetch there reads as a page reload.
import Assessments from "@/pages/Assessments";
import Resolve from "@/pages/Resolve";

const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const NewAssessment = lazy(() => import("@/pages/NewAssessment"));
const AssessmentDetail = lazy(() => import("@/pages/AssessmentDetail"));
const TestDetail = lazy(() => import("@/pages/TestDetail"));
const ManualTestSteps = lazy(() => import("@/pages/ManualTestSteps"));
const RunDetail = lazy(() => import("@/pages/RunDetail"));
const ResolveApplication = lazy(() => import("@/pages/ResolveApplication"));
const ResolveTicket = lazy(() => import("@/pages/ResolveTicket"));
const ResolveRisk = lazy(() => import("@/pages/ResolveRisk"));
const ControlDetail = lazy(() => import("@/pages/ControlDetail"));
const ControlPreview = lazy(() => import("@/pages/ControlPreview"));
const Settings = lazy(() => import("@/pages/Settings"));
const Admin = lazy(() => import("@/pages/Admin"));
const Learn = lazy(() => import("@/pages/Learn"));

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, profile, profileError, refreshProfile } = useAuth();
  if (loading) return <LoadingState label="Loading…" />;
  if (!session) return <Navigate to="/login" replace />;
  // Only an initial load leaves both unset; a failed background refresh keeps
  // the previous profile and never reaches this.
  if (!profile && profileError) {
    return (
      <ErrorState
        message="We could not load your account profile."
        onRetry={() => void refreshProfile()}
      />
    );
  }
  return <>{children}</>;
}

/** The index is whatever `defaultRouteFor` says, so no page owns a competing rule. */
function RoleHome() {
  const { profile, loading } = useAuth();
  if (loading) return <LoadingState label="Loading…" />;
  const home = defaultRouteFor(profile);
  return home === "/" ? <Dashboard /> : <Navigate to={home} replace />;
}

/** Any one of the listed capabilities admits: RLS still scopes what is visible. */
function RequireCapability({
  capability,
  children,
}: {
  capability: Capability | Capability[];
  children: ReactNode;
}) {
  const { can } = useAuth();
  const allowed = Array.isArray(capability) ? capability : [capability];
  if (!allowed.some(can)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Suspense fallback={<LoadingState label="Loading…" />}>
            <Login />
          </Suspense>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<RoleHome />} />

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
            <RequireCapability capability={["view_assessments", "view_risk_conversation"]}>
              <TestDetail />
            </RequireCapability>
          }
        />
        <Route
          path="assessments/:assessmentId/tests/:testId/runs/:runId"
          element={
            <RequireCapability capability={["view_assessments", "view_risk_conversation"]}>
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

        <Route path="findings" element={<LegacyListRedirect />} />
        <Route path="findings/:findingId" element={<LegacyFindingRedirect />} />
        <Route
          path="findings/:findingId/controls/:controlId"
          element={<LegacyFindingRedirect />}
        />

        <Route path="tickets" element={<LegacyListRedirect />} />
        <Route path="tickets/:ticketId" element={<LegacyTicketRedirect />} />
        <Route path="tickets/:ticketId/controls/:controlId" element={<LegacyTicketRedirect />} />

        <Route
          path="resolve"
          element={
            <ResolveGuard>
              <Resolve />
            </ResolveGuard>
          }
        />
        <Route
          path="resolve/applications/:applicationId/risks/:riskId"
          element={
            <ResolveGuard>
              <ResolveRisk />
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
  );
}
