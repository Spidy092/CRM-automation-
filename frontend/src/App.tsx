import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { apiClient, ensureAccessToken } from '@/api/client';
import type { ApiResponse } from '@/api/client';
import type { User } from '@/types';
import { Layout } from '@/components/Layout';
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { LeadsPage } from '@/pages/LeadsPage';
import { LeadFormPage } from '@/pages/LeadFormPage';
import { ImportLeadsPage } from '@/pages/ImportLeadsPage';
import { CampaignsPage } from '@/pages/CampaignsPage';
import { CampaignFormPage } from '@/pages/CampaignFormPage';
import { PipelineBoardPage } from '@/pages/PipelineBoardPage';
import { PipelineManagePage } from '@/pages/PipelineManagePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/UsersPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { TeamDashboardPage } from '@/pages/TeamDashboardPage';
import { ScraperConfigPage } from '@/pages/ScraperConfigPage';
import { ScoringPage } from '@/pages/ScoringPage';
import { AssignmentsPage } from '@/pages/AssignmentsPage';
import { IntegrationsPage } from '@/pages/IntegrationsPage';
import { ApiKeysPage } from '@/pages/ApiKeysPage';
import AISettingsPage from '@/pages/AISettingsPage';
import { OutreachSequencesPage } from '@/pages/OutreachSequencesPage';
import { AutomationRulesPage } from '@/pages/AutomationRulesPage';
import { LeadDetailPage } from '@/pages/LeadDetailPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { TemplateFormPage } from '@/pages/TemplateFormPage';
import { FilesLibraryPage } from '@/pages/FilesLibraryPage';
import { MessagesLibraryPage } from '@/pages/MessagesLibraryPage';
import { PagesLibraryPage } from '@/pages/PagesLibraryPage';
import { PageEditorPage } from '@/pages/PageEditorPage';
import { PublicLandingPage } from '@/pages/PublicLandingPage';
import { CustomFieldsPage } from '@/pages/CustomFieldsPage';
import { AIInboxPage } from '@/pages/AIInboxPage';
import { LeadAIProfilePage } from '@/pages/LeadAIProfilePage';
import { CampaignBriefPage } from '@/pages/CampaignBriefPage';
import { AIDecisionLogPage } from '@/pages/AIDecisionLogPage';
import { CampaignDetailPage } from '@/pages/CampaignDetailPage';
import { FormsPage } from '@/pages/FormsPage';
import { FormBuilderPage } from '@/pages/FormBuilderPage';
import { FormAnalyticsPage } from '@/pages/FormAnalyticsPage';
import { ABTestPage } from '@/pages/ABTestPage';
import { SchedulingPage } from '@/pages/SchedulingPage';
import { PublicBookingPage } from '@/pages/PublicBookingPage';
import { PublicFormPage } from '@/pages/PublicFormPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { NewsletterPage } from '@/pages/NewsletterPage';
import { PublicSubscribePage } from '@/pages/PublicSubscribePage';
import { PublicNewsletterActionPage } from '@/pages/PublicNewsletterActionPage';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * AppInitializer — restores session from refreshToken on page load.
 * Refreshes the in-memory access token from the stored refresh token, then
 * calls GET /auth/me to restore the current user. Access tokens still stay
 * in memory only; refresh tokens remain the only persisted auth credential.
 */
function AppInitializer({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, isLoading } = useAuthStore();

  useEffect(() => {
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

function App() {
  return (
    <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Router>
          <AppInitializer>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Layout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="ai-inbox" element={<AIInboxPage />} />
                <Route path="leads" element={<LeadsPage />} />
                <Route path="leads/new" element={<LeadFormPage />} />
                <Route path="leads/import" element={<ImportLeadsPage />} />
                <Route path="leads/:id" element={<LeadDetailPage />} />
                <Route path="leads/:id/ai" element={<LeadAIProfilePage />} />
                <Route path="leads/:id/edit" element={<LeadFormPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/new" element={<CampaignFormPage />} />
                <Route path="campaigns/:id" element={<CampaignDetailPage />} />
                <Route path="campaigns/:id/edit" element={<CampaignFormPage />} />
                <Route path="campaigns/:id/brief" element={<CampaignBriefPage />} />
                <Route path="admin/ai-decisions" element={<AIDecisionLogPage />} />
                <Route path="pipelines" element={<PipelineBoardPage />} />
          <Route path="pipelines/manage" element={<PipelineManagePage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="team-dashboard" element={<TeamDashboardPage />} />
                <Route path="scraper" element={<ScraperConfigPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="settings/users" element={<UsersPage />} />
                <Route path="settings/ai" element={<AISettingsPage />} />
                <Route path="settings/scoring" element={<ScoringPage />} />
                <Route path="settings/assignments" element={<AssignmentsPage />} />
                <Route path="settings/integrations" element={<IntegrationsPage />} />
                <Route path="settings/api-keys" element={<ApiKeysPage />} />
                <Route path="automation/rules" element={<AutomationRulesPage />} />
                <Route path="outreach/sequences" element={<OutreachSequencesPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="templates/new" element={<TemplateFormPage />} />
                <Route path="templates/:id/edit" element={<TemplateFormPage />} />
                <Route path="files" element={<FilesLibraryPage />} />
                <Route path="messages" element={<MessagesLibraryPage />} />
                <Route path="pages" element={<PagesLibraryPage />} />
                <Route path="pages/new" element={<PageEditorPage />} />
                <Route path="pages/:id/edit" element={<PageEditorPage />} />
                <Route path="settings/custom-fields" element={<CustomFieldsPage />} />
                <Route path="forms" element={<FormsPage />} />
                <Route path="forms/new" element={<FormBuilderPage />} />
                <Route path="forms/:id/edit" element={<FormBuilderPage />} />
                <Route path="forms/:id/analytics" element={<FormAnalyticsPage />} />
                <Route path="ab-testing" element={<ABTestPage />} />
                <Route path="scheduling" element={<SchedulingPage />} />
                <Route path="newsletter" element={<NewsletterPage />} />
              </Route>
              <Route path="/forms/:slug" element={<PublicFormPage />} />
              <Route path="/book/:slug" element={<PublicBookingPage />} />
              <Route path="/p/:slug" element={<PublicLandingPage />} />
              <Route path="/subscribe" element={<PublicSubscribePage />} />
              <Route path="/newsletter/:action" element={<PublicNewsletterActionPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AppInitializer>
        </Router>
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
