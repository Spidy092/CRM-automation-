import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Settings, Users, Link2, FileText, Bot, Route, SlidersHorizontal } from 'lucide-react';

const settingsGroups = [
  {
    title: 'User Management',
    description: 'Manage users, roles, and permissions.',
    icon: Users,
    action: 'Manage Users',
    path: '/settings/users',
  },
  {
    title: 'Integrations',
    description: 'Connect WhatsApp, Twilio, SendGrid, ads, and other services.',
    icon: Link2,
    action: 'Configure Integrations',
    path: '/settings/integrations',
  },
  {
    title: 'Custom Fields',
    description: 'Define CRM-specific lead and contact fields.',
    icon: FileText,
    action: 'Manage Fields',
  },
  {
    title: 'Lead Scoring',
    description: 'Configure lead scoring rules and hot/warm/cold thresholds.',
    icon: SlidersHorizontal,
    action: 'Manage Scoring',
    path: '/settings/scoring',
  },
  {
    title: 'Assignments',
    description: 'Tune round-robin routing and override rules.',
    icon: Route,
    action: 'Manage Routing',
    path: '/settings/assignments',
  },
  {
    title: 'AI Personalization',
    description: 'Configure model settings used by outreach personalization.',
    icon: Bot,
    action: 'AI Settings',
    path: '/settings/ai',
  },
  {
    title: 'API Keys',
    description: 'Manage Personal Access Tokens for MCP and AI agents.',
    icon: Link2, // Using Link2 for connection, or a key icon if one exists. Let's stick with Link2 as it's already imported.
    action: 'Manage Keys',
    path: '/settings/api-keys',
  },
];

export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        description="Control access, routing, integrations, scoring, and AI behavior from one operational hub."
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {settingsGroups.map((group) => (
          <Card key={group.title}>
            <CardHeader>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
                  <group.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle>{group.title}</CardTitle>
                  <CardDescription className="mt-1 leading-5">{group.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                className="w-full justify-between"
                onClick={() => group.path && navigate(group.path)}
                disabled={!group.path}
              >
                {group.action}
                <Settings className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
