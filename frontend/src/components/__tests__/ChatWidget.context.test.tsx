import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { buildPageContext } from '../ChatWidget';
import type { ScraperConfig, DashboardMetrics, User, CustomFieldDefinition } from '@/types';
import type { Integration } from '@/api/integrations';
import type { ScoringConfig, ScoringRule } from '@/api/scoring';
import type { AssignmentConfig, EligibleUser } from '@/api/assignments';
import type { AiInboxItem } from '@/api/aiInbox';

function createClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('buildPageContext', () => {
  it('includes visible scraper records and run action on the scraper page', () => {
    const queryClient = createClient();
    const configs: ScraperConfig[] = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'my web scrapper',
        source_type: 'web_scrape',
        is_active: true,
        config: {},
        schedule_cron: null,
        last_run_at: null,
        created_by: 'user-1',
        created_at: '2026-06-29T00:00:00.000Z',
        updated_at: '2026-06-29T00:00:00.000Z',
        health: 'unknown',
        webhook_url: null,
        group_name: null,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'places',
        source_type: 'google_places',
        is_active: true,
        config: {},
        schedule_cron: null,
        last_run_at: '2026-06-29T00:00:00.000Z',
        created_by: 'user-1',
        created_at: '2026-06-29T00:00:00.000Z',
        updated_at: '2026-06-29T00:00:00.000Z',
        health: 'healthy',
        webhook_url: null,
        group_name: null,
      },
    ];
    queryClient.setQueryData(['scraper', 'configs'], configs);

    const context = buildPageContext('/scraper', queryClient);

    expect(context.pageTitle).toBe('Scraper');
    expect(context.availableActions).toContain('scraper.run');
    expect(context.pageCapabilities).toContain('Run a scraper source after approval');
    expect(context.visibleRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'scraper', id: configs[0].id, name: 'my web scrapper', status: 'active' }),
        expect.objectContaining({ type: 'scraper', id: configs[1].id, name: 'places', status: 'active' }),
      ]),
    );
  });

  it('includes AI settings capabilities and safe metrics without exposing secrets', () => {
    const queryClient = createClient();
    queryClient.setQueryData(['ai-settings'], {
      enabled: true,
      has_api_key: true,
      model: 'gpt-4o',
      base_url: null,
      max_tokens: 500,
      temperature: 0.2,
    });

    const context = buildPageContext('/settings/ai', queryClient);

    expect(context.pageTitle).toBe('AI Settings');
    expect(context.pageCapabilities).toEqual(
      expect.arrayContaining([
        'Configure AI provider settings',
        'Check whether an API key is stored',
      ]),
    );
    expect(context.pageMetrics).toEqual(
      expect.objectContaining({
        aiEnabled: true,
        hasApiKey: true,
        model: 'gpt-4o',
        usesCustomBaseUrl: false,
        maxTokens: 500,
        temperature: 0.2,
      }),
    );
    expect(JSON.stringify(context)).not.toContain('api_key');
  });

  it('includes integration records from the integrations cache', () => {
    const queryClient = createClient();
    const integrations: Integration[] = [
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'whatsapp',
        display_name: 'WhatsApp',
        is_enabled: true,
        last_tested_at: null,
        last_test_status: 'ok',
        updated_by: null,
        updated_at: '2026-06-29T00:00:00.000Z',
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'sendgrid',
        display_name: 'SendGrid',
        is_enabled: false,
        last_tested_at: null,
        last_test_status: 'not_tested',
        updated_by: null,
        updated_at: '2026-06-29T00:00:00.000Z',
      },
    ];
    queryClient.setQueryData(['integrations'], integrations);

    const context = buildPageContext('/settings/integrations', queryClient);

    expect(context.pageTitle).toBe('Integrations');
    expect(context.pageCapabilities).toContain('Review integration status');
    expect(context.visibleRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'integration', name: 'WhatsApp', status: 'enabled' }),
        expect.objectContaining({ type: 'integration', name: 'SendGrid', status: 'disabled' }),
      ]),
    );
  });

  it('includes dashboard metrics and read actions on the dashboard', () => {
    const queryClient = createClient();
    const metrics: DashboardMetrics = {
      totalLeads: 20,
      qualifiedLeads: 8,
      totalCampaigns: 3,
      activeOutreach: 5,
      pipelineConversion: 40,
      recentActivity: [],
    };
    queryClient.setQueryData(['reports', 'dashboard'], metrics);

    const context = buildPageContext('/', queryClient);

    expect(context.pageTitle).toBe('Dashboard');
    expect(context.availableActions).toEqual(expect.arrayContaining(['report.dashboard', 'lead.list', 'campaign.list']));
    expect(context.pageMetrics).toEqual(
      expect.objectContaining({
        totalLeads: 20,
        qualifiedLeads: 8,
        totalCampaigns: 3,
        activeOutreach: 5,
        pipelineConversion: 40,
      }),
    );
  });

  it('includes admin/settings visible records for users, scoring, assignments, and custom fields', () => {
    const userClient = createClient();
    const users: User[] = [
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'admin',
        is_available: true,
        is_active: true,
        created_at: '2026-06-29T00:00:00.000Z',
        updated_at: '2026-06-29T00:00:00.000Z',
      },
    ];
    userClient.setQueryData(['users'], users);
    expect(buildPageContext('/settings/users', userClient).visibleRecords).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'user', name: 'Admin User', status: 'active' })]),
    );

    const scoringClient = createClient();
    const scoringConfig: ScoringConfig = {
      id: '66666666-6666-4666-8666-666666666666',
      hot_min_score: 70,
      warm_min_score: 40,
      assignment_threshold: 50,
      updated_at: '2026-06-29T00:00:00.000Z',
    };
    const scoringRules: ScoringRule[] = [
      {
        id: '77777777-7777-4777-8777-777777777777',
        factor: 'rating',
        weight: 2,
        condition: {},
        score_value: 10,
        is_active: true,
        created_at: '2026-06-29T00:00:00.000Z',
        updated_at: '2026-06-29T00:00:00.000Z',
      },
    ];
    scoringClient.setQueryData(['scoring-config'], scoringConfig);
    scoringClient.setQueryData(['scoring-rules'], scoringRules);
    const scoringContext = buildPageContext('/settings/scoring', scoringClient);
    expect(scoringContext.pageMetrics).toEqual(expect.objectContaining({ hotMinScore: 70, warmMinScore: 40 }));
    expect(scoringContext.visibleRecords).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'scoring_rule', name: 'rating', status: 'active' })]),
    );

    const assignmentClient = createClient();
    const assignmentConfig: AssignmentConfig = {
      id: '88888888-8888-4888-8888-888888888888',
      is_enabled: true,
      threshold_score: 60,
      eligible_roles: ['sales'],
      updated_at: '2026-06-29T00:00:00.000Z',
    };
    const eligibleUsers: EligibleUser[] = [
      { id: '99999999-9999-4999-8999-999999999999', first_name: 'Sales', last_name: 'Rep', email: 'sales@example.com', role: 'sales' },
    ];
    assignmentClient.setQueryData(['assignments-config'], assignmentConfig);
    assignmentClient.setQueryData(['assignments-eligible-users'], eligibleUsers);
    const assignmentContext = buildPageContext('/settings/assignments', assignmentClient);
    expect(assignmentContext.pageMetrics).toEqual(expect.objectContaining({ assignmentEnabled: true, thresholdScore: 60 }));
    expect(assignmentContext.visibleRecords).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'assignment_user', name: 'Sales Rep', status: 'sales' })]),
    );

    const fieldsClient = createClient();
    const fields: CustomFieldDefinition[] = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        label: 'Budget',
        field_key: 'budget',
        field_type: 'number',
        options: null,
        is_required: false,
        is_active: true,
        created_by: 'user-1',
        created_at: '2026-06-29T00:00:00.000Z',
        updated_at: '2026-06-29T00:00:00.000Z',
      },
    ];
    fieldsClient.setQueryData(['custom-fields'], fields);
    expect(buildPageContext('/settings/custom-fields', fieldsClient).visibleRecords).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'custom_field', name: 'Budget', status: 'active' })]),
    );
  });

  it('includes AI Inbox items for visible approval work', () => {
    const queryClient = createClient();
    const item: AiInboxItem = {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      assigned_to: 'user-1',
      lead_id: null,
      campaign_id: null,
      item_type: 'approve_response',
      title: 'Approve agent action: scraper.run',
      summary: null,
      urgency_score: 70,
      ai_draft_response: null,
      ai_draft_confidence: null,
      expires_at: null,
      status: 'pending',
      snoozed_until: null,
      actioned_by: null,
      actioned_at: null,
      created_at: '2026-06-29T00:00:00.000Z',
      updated_at: '2026-06-29T00:00:00.000Z',
      agent_action_id: null,
      action_result: null,
    };
    queryClient.setQueryData(['ai-inbox', { status: 'pending' }], { items: [item], total: 1 });

    const context = buildPageContext('/ai-inbox', queryClient);

    expect(context.availableActions).toContain('ai.inbox.action');
    expect(context.visibleRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ai_inbox_item', name: 'Approve agent action: scraper.run', status: 'pending' }),
      ]),
    );
  });
});
