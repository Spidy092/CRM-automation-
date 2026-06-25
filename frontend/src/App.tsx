import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { apiClient } from '@/api/client';
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
import { PipelinePage } from '@/pages/PipelinePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { UsersPage } from '@/pages/UsersPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { ScraperConfigPage } from '@/pages/ScraperConfigPage';
import { ScoringPage } from '@/pages/ScoringPage';
import { AssignmentsPage } from '@/pages/AssignmentsPage';
import { IntegrationsPage } from '@/pages/IntegrationsPage';
import AISettingsPage from '@/pages/AISettingsPage';
import { OutreachSequencesPage } from '@/pages/OutreachSequencesPage';
import { AutomationRulesPage } from '@/pages/AutomationRulesPage';
import { LeadDetailPage } from '@/pages/LeadDetailPage';
import { TemplatesPage } from '@/pages/TemplatesPage';
import { TemplateFormPage } from '@/pages/TemplateFormPage';
import { CustomFieldsPage } from '@/pages/CustomFieldsPage';
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
 * Calls GET /auth/me which requires a valid access token. If the access
 * token is missing (page refresh), the refresh interceptor in client.ts
 * automatically fetches a new one using the stored refreshToken before
 * this request proceeds.
 */
function AppInitializer({ children }: { children: React.ReactNode }) {
  const { setUser, setAccessToken, setLoading, isLoading } = useAuthStore();

  useEffect(() => {
    const hasRefreshToken = !!localStorage.getItem('refreshToken');

    if (!hasRefreshToken) {
      setLoading(false);
      return;
    }

    apiClient
      .get<ApiResponse<User>>('/auth/me')
      .then((response) => {
        const user = response.data.data;
        // The refresh interceptor has already set the in-memory access token
        // if a token exchange was needed. We just need to mark the user as set.
        setUser({ id: user.id, name: user.name, email: user.email, role: user.role });
        // Pull the token that was stored in the store by the interceptor
        const storedToken = useAuthStore.getState().accessToken;
        if (storedToken) {
          setAccessToken(storedToken);
        }
      })
      .catch(() => {
        // Session could not be restored — clear stale refresh token
        localStorage.removeItem('refreshToken');
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
                <Route path="leads" element={<LeadsPage />} />
                <Route path="leads/new" element={<LeadFormPage />} />
                <Route path="leads/import" element={<ImportLeadsPage />} />
                <Route path="leads/:id" element={<LeadDetailPage />} />
                <Route path="leads/:id/edit" element={<LeadFormPage />} />
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/new" element={<CampaignFormPage />} />
                <Route path="pipelines" element={<PipelinePage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="scraper" element={<ScraperConfigPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="settings/users" element={<UsersPage />} />
                <Route path="settings/ai" element={<AISettingsPage />} />
                <Route path="settings/scoring" element={<ScoringPage />} />
                <Route path="settings/assignments" element={<AssignmentsPage />} />
                <Route path="settings/integrations" element={<IntegrationsPage />} />
                <Route path="automation/rules" element={<AutomationRulesPage />} />
                <Route path="outreach/sequences" element={<OutreachSequencesPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="templates/new" element={<TemplateFormPage />} />
                <Route path="templates/:id/edit" element={<TemplateFormPage />} />
                <Route path="settings/custom-fields" element={<CustomFieldsPage />} />
              </Route>
            </Routes>
          </AppInitializer>
        </Router>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export default App;
