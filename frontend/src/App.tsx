import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { apiClient, ensureAccessToken } from '@/api/client';
import type { ApiResponse } from '@/api/client';
import type { User, UserRole } from '@/types';
import { Layout } from '@/components/Layout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import { initTheme } from '@/lib/theme';

// ── Lazy-loaded page components (code-split by route) ──────────────────────
const LoginPage = lazy(() => import('@/pages/LoginPage').then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPasswordPage').then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const LeadsPage = lazy(() => import('@/pages/LeadsPage').then(m => ({ default: m.LeadsPage })));
const LeadFormPage = lazy(() => import('@/pages/LeadFormPage').then(m => ({ default: m.LeadFormPage })));
const ImportLeadsPage = lazy(() => import('@/pages/ImportLeadsPage').then(m => ({ default: m.ImportLeadsPage })));
const CampaignsPage = lazy(() => import('@/pages/CampaignsPage').then(m => ({ default: m.CampaignsPage })));
const CampaignFormPage = lazy(() => import('@/pages/CampaignFormPage').then(m => ({ default: m.CampaignFormPage })));
const PipelineBoardPage = lazy(() => import('@/pages/PipelineBoardPage').then(m => ({ default: m.PipelineBoardPage })));
const PipelineManagePage = lazy(() => import('@/pages/PipelineManagePage').then(m => ({ default: m.PipelineManagePage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then(m => ({ default: m.UsersPage })));
const ReportsPage = lazy(() => import('@/pages/ReportsPage').then(m => ({ default: m.ReportsPage })));
const TeamDashboardPage = lazy(() => import('@/pages/TeamDashboardPage').then(m => ({ default: m.TeamDashboardPage })));
const ScraperConfigPage = lazy(() => import('@/pages/ScraperConfigPage').then(m => ({ default: m.ScraperConfigPage })));
const ScoringPage = lazy(() => import('@/pages/ScoringPage').then(m => ({ default: m.ScoringPage })));
const AssignmentsPage = lazy(() => import('@/pages/AssignmentsPage').then(m => ({ default: m.AssignmentsPage })));
const IntegrationsPage = lazy(() => import('@/pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const ApiKeysPage = lazy(() => import('@/pages/ApiKeysPage').then(m => ({ default: m.ApiKeysPage })));
const AISettingsPage = lazy(() => import('@/pages/AISettingsPage'));
const OutreachSequencesPage = lazy(() => import('@/pages/OutreachSequencesPage').then(m => ({ default: m.OutreachSequencesPage })));
const AutomationRulesPage = lazy(() => import('@/pages/AutomationRulesPage').then(m => ({ default: m.AutomationRulesPage })));
const LeadDetailPage = lazy(() => import('@/pages/LeadDetailPage').then(m => ({ default: m.LeadDetailPage })));
const TemplatesPage = lazy(() => import('@/pages/TemplatesPage').then(m => ({ default: m.TemplatesPage })));
const TemplateFormPage = lazy(() => import('@/pages/TemplateFormPage').then(m => ({ default: m.TemplateFormPage })));
const FilesLibraryPage = lazy(() => import('@/pages/FilesLibraryPage').then(m => ({ default: m.FilesLibraryPage })));
const MessagesLibraryPage = lazy(() => import('@/pages/MessagesLibraryPage').then(m => ({ default: m.MessagesLibraryPage })));
const PagesLibraryPage = lazy(() => import('@/pages/PagesLibraryPage').then(m => ({ default: m.PagesLibraryPage })));
const PageEditorPage = lazy(() => import('@/pages/PageEditorPage').then(m => ({ default: m.PageEditorPage })));
const PublicLandingPage = lazy(() => import('@/pages/PublicLandingPage').then(m => ({ default: m.PublicLandingPage })));
const CustomFieldsPage = lazy(() => import('@/pages/CustomFieldsPage').then(m => ({ default: m.CustomFieldsPage })));
const AIInboxPage = lazy(() => import('@/pages/AIInboxPage').then(m => ({ default: m.AIInboxPage })));
const LeadAIProfilePage = lazy(() => import('@/pages/LeadAIProfilePage').then(m => ({ default: m.LeadAIProfilePage })));
const CampaignBriefPage = lazy(() => import('@/pages/CampaignBriefPage').then(m => ({ default: m.CampaignBriefPage })));
const AIDecisionLogPage = lazy(() => import('@/pages/AIDecisionLogPage').then(m => ({ default: m.AIDecisionLogPage })));
const CampaignDetailPage = lazy(() => import('@/pages/CampaignDetailPage').then(m => ({ default: m.CampaignDetailPage })));
const FormsPage = lazy(() => import('@/pages/FormsPage').then(m => ({ default: m.FormsPage })));
const FormBuilderPage = lazy(() => import('@/pages/FormBuilderPage').then(m => ({ default: m.FormBuilderPage })));
const FormAnalyticsPage = lazy(() => import('@/pages/FormAnalyticsPage').then(m => ({ default: m.FormAnalyticsPage })));
const ABTestPage = lazy(() => import('@/pages/ABTestPage').then(m => ({ default: m.ABTestPage })));
const SchedulingPage = lazy(() => import('@/pages/SchedulingPage').then(m => ({ default: m.SchedulingPage })));
const PublicBookingPage = lazy(() => import('@/pages/PublicBookingPage').then(m => ({ default: m.PublicBookingPage })));
const PublicFormPage = lazy(() => import('@/pages/PublicFormPage').then(m => ({ default: m.PublicFormPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then(m => ({ default: m.NotFoundPage })));
const NewsletterPage = lazy(() => import('@/pages/NewsletterPage').then(m => ({ default: m.NewsletterPage })));
const PublicSubscribePage = lazy(() => import('@/pages/PublicSubscribePage').then(m => ({ default: m.PublicSubscribePage })));
const PublicNewsletterActionPage = lazy(() => import('@/pages/PublicNewsletterActionPage').then(m => ({ default: m.PublicNewsletterActionPage })));
const AccountPage = lazy(() => import('@/pages/AccountPage').then(m => ({ default: m.AccountPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Minimal loading spinner shown while lazy chunks load. */
function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
        <p className="text-sm text-slate-400">Loading…</p>
      </div>
    </div>
  );
}

/**
 * AppInitializer — restores session from refreshToken on page load.
 */
function AppInitializer({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, isLoading } = useAuthStore();

  useEffect(() => {
    initTheme();
    const hasRefreshToken = !!localStorage.getItem('refreshToken');

    if (!hasRefreshToken) {
      setLoading(false);
      return;
    }

    ensureAccessToken()
      .then(() => apiClient.get<ApiResponse<User>>('/auth/me'))
      .then((response) => {
        const user = response.data.data;
        setUser({ id: user.id, name: user.name, email: user.email, role: user.role });
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f0c29]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-slate-400">Restoring session…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RoleRoute({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { user } = useAuthStore();

  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

/** Wraps a lazy page component with RouteErrorBoundary + Suspense for isolation. */
function LazyPage({ children }: { children: React.ReactNode }) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Router>
          <AppInitializer>
            <Routes>
              <Route path="/login" element={<LazyPage><LoginPage /></LazyPage>} />
              <Route path="/forgot-password" element={<LazyPage><ForgotPasswordPage /></LazyPage>} />
              <Route path="/reset-password" element={<LazyPage><ResetPasswordPage /></LazyPage>} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<LazyPage><DashboardPage /></LazyPage>} />
                <Route path="ai-inbox" element={<LazyPage><AIInboxPage /></LazyPage>} />
                <Route path="leads" element={<LazyPage><LeadsPage /></LazyPage>} />
                <Route path="leads/new" element={<LazyPage><LeadFormPage /></LazyPage>} />
                <Route path="leads/import" element={<LazyPage><ImportLeadsPage /></LazyPage>} />
                <Route path="leads/:id" element={<LazyPage><LeadDetailPage /></LazyPage>} />
                <Route path="leads/:id/ai" element={<LazyPage><LeadAIProfilePage /></LazyPage>} />
                <Route path="leads/:id/edit" element={<LazyPage><LeadFormPage /></LazyPage>} />
                <Route path="campaigns" element={<LazyPage><CampaignsPage /></LazyPage>} />
                <Route path="campaigns/new" element={<LazyPage><CampaignFormPage /></LazyPage>} />
                <Route path="campaigns/:id" element={<LazyPage><CampaignDetailPage /></LazyPage>} />
                <Route path="campaigns/:id/edit" element={<LazyPage><CampaignFormPage /></LazyPage>} />
                <Route path="campaigns/:id/brief" element={<LazyPage><CampaignBriefPage /></LazyPage>} />
                <Route
                  path="admin/ai-decisions"
                  element={
                    <RoleRoute roles={['admin']}>
                      <LazyPage><AIDecisionLogPage /></LazyPage>
                    </RoleRoute>
                  }
                />
                <Route path="pipelines" element={<LazyPage><PipelineBoardPage /></LazyPage>} />
                <Route
                  path="pipelines/manage"
                  element={
                    <RoleRoute roles={['admin', 'manager']}>
                      <LazyPage><PipelineManagePage /></LazyPage>
                    </RoleRoute>
                  }
                />
                <Route path="reports" element={<LazyPage><ReportsPage /></LazyPage>} />
                <Route path="team-dashboard" element={<LazyPage><TeamDashboardPage /></LazyPage>} />
                <Route path="scraper" element={<LazyPage><ScraperConfigPage /></LazyPage>} />
                <Route path="settings" element={<LazyPage><SettingsPage /></LazyPage>} />
                <Route
                  path="settings/users"
                  element={
                    <RoleRoute roles={['admin', 'manager']}>
                      <LazyPage><UsersPage /></LazyPage>
                    </RoleRoute>
                  }
                />
                <Route path="settings/ai" element={<LazyPage><AISettingsPage /></LazyPage>} />
                <Route path="settings/scoring" element={<LazyPage><ScoringPage /></LazyPage>} />
                <Route path="settings/assignments" element={<LazyPage><AssignmentsPage /></LazyPage>} />
                <Route path="settings/integrations" element={<LazyPage><IntegrationsPage /></LazyPage>} />
                <Route path="settings/api-keys" element={<LazyPage><ApiKeysPage /></LazyPage>} />
                <Route path="automation/rules" element={<LazyPage><AutomationRulesPage /></LazyPage>} />
                <Route path="outreach/sequences" element={<LazyPage><OutreachSequencesPage /></LazyPage>} />
                <Route path="templates" element={<LazyPage><TemplatesPage /></LazyPage>} />
                <Route path="templates/new" element={<LazyPage><TemplateFormPage /></LazyPage>} />
                <Route path="templates/:id/edit" element={<LazyPage><TemplateFormPage /></LazyPage>} />
                <Route path="files" element={<LazyPage><FilesLibraryPage /></LazyPage>} />
                <Route path="messages" element={<LazyPage><MessagesLibraryPage /></LazyPage>} />
                <Route path="pages" element={<LazyPage><PagesLibraryPage /></LazyPage>} />
                <Route path="pages/new" element={<LazyPage><PageEditorPage /></LazyPage>} />
                <Route path="pages/:id/edit" element={<LazyPage><PageEditorPage /></LazyPage>} />
                <Route path="settings/custom-fields" element={<LazyPage><CustomFieldsPage /></LazyPage>} />
                <Route path="forms" element={<LazyPage><FormsPage /></LazyPage>} />
                <Route path="forms/new" element={<LazyPage><FormBuilderPage /></LazyPage>} />
                <Route path="forms/:id/edit" element={<LazyPage><FormBuilderPage /></LazyPage>} />
                <Route path="forms/:id/analytics" element={<LazyPage><FormAnalyticsPage /></LazyPage>} />
                <Route path="ab-testing" element={<LazyPage><ABTestPage /></LazyPage>} />
                <Route path="scheduling" element={<LazyPage><SchedulingPage /></LazyPage>} />
                <Route path="newsletter" element={<LazyPage><NewsletterPage /></LazyPage>} />
                <Route path="account" element={<LazyPage><AccountPage /></LazyPage>} />
              </Route>
              <Route path="/forms/:slug" element={<LazyPage><PublicFormPage /></LazyPage>} />
              <Route path="/book/:slug" element={<LazyPage><PublicBookingPage /></LazyPage>} />
              <Route path="/p/:slug" element={<LazyPage><PublicLandingPage /></LazyPage>} />
              <Route path="/subscribe" element={<LazyPage><PublicSubscribePage /></LazyPage>} />
              <Route path="/newsletter/:action" element={<LazyPage><PublicNewsletterActionPage /></LazyPage>} />
              <Route path="*" element={<LazyPage><NotFoundPage /></LazyPage>} />
            </Routes>
          </AppInitializer>
        </Router>
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
