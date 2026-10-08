import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/lib/test-utils';
import { SequenceMessagePreview } from '../SequenceMessagePreview';
import type { Sequence } from '@/api/outreach';
import type { Template } from '@/types';

const mockSequence: Sequence = {
  id: 'seq-cold',
  name: 'Cold Email',
  description: 'Three touches',
  steps: [
    {
      stepNumber: 1,
      channel: 'email',
      delayHours: 0,
      templateId: 'tpl-1',
    },
    {
      stepNumber: 2,
      channel: 'email',
      delayHours: 72,
      templateId: 'tpl-2',
    },
  ],
  is_active: true,
  created_by: 'user-1',
  deleted_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockTemplates: Template[] = [
  {
    id: 'tpl-1',
    name: 'Cold Email · Step 1 — Intro',
    channel: 'email',
    subject: 'Quick question about {{company}}',
    body: 'Hi {{first_name}},\n\nSaw your company {{company}} and wanted to reach out.',
    variables: ['company', 'first_name'],
    attachments: [],
    approval_status: 'approved',
    approved_by: 'user-1',
    approved_at: new Date().toISOString(),
    rejection_reason: null,
    created_by: 'user-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'tpl-2',
    name: 'Cold Email · Step 2 — Proof',
    channel: 'email',
    subject: 'Case study for {{company}}',
    body: 'Hi {{first_name}},\n\nHere is how we helped a client like {{company}}.',
    variables: ['company', 'first_name'],
    attachments: [],
    approval_status: 'approved',
    approved_by: 'user-1',
    approved_at: new Date().toISOString(),
    rejection_reason: null,
    created_by: 'user-1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const templateById = new Map(mockTemplates.map((t) => [t.id, t]));

describe('SequenceMessagePreview', () => {
  it('renders all steps with subject, body, and variable highlights', () => {
    renderWithProviders(
      <SequenceMessagePreview
        sequence={mockSequence}
        templateById={templateById}
        initiallyOpen={true}
      />,
    );

    expect(screen.getByText(/Message Content Preview/i)).toBeInTheDocument();
    expect(screen.getByText('2 touches')).toBeInTheDocument();

    // Step 1
    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Cold Email · Step 1 — Intro')).toBeInTheDocument();
    expect(screen.getByText(/Quick question about/i)).toBeInTheDocument();

    // Step 2
    expect(screen.getByText('Step 2')).toBeInTheDocument();
    expect(screen.getByText('Cold Email · Step 2 — Proof')).toBeInTheDocument();
    expect(screen.getByText(/Case study for/i)).toBeInTheDocument();

    // Variables rendered in styled badges
    const companyTags = screen.getAllByText('{{company}}');
    expect(companyTags.length).toBeGreaterThanOrEqual(2);
    const firstNameTags = screen.getAllByText('{{first_name}}');
    expect(firstNameTags.length).toBeGreaterThanOrEqual(2);
  });

  it('shows the portfolio filename and an edit link for the selected email', () => {
    const templates = new Map(templateById);
    templates.set('tpl-1', {
      ...mockTemplates[0],
      attachments: [{
        id: 'attachment-1', filename: 'school-portfolio.pdf', mimeType: 'application/pdf',
        sizeBytes: 2048, url: '/uploads/school-portfolio.pdf',
      }],
    });
    renderWithProviders(<SequenceMessagePreview sequence={mockSequence} templateById={templates} />);
    expect(screen.getByText('school-portfolio.pdf')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /add portfolio or images/i })[0]).toHaveAttribute(
      'href', '/templates/tpl-1/edit',
    );
    expect(screen.getByText('No files attached.')).toBeInTheDocument();
  });

  it('previews the portfolio as a safe clickable button without showing its HTML', () => {
    const templates = new Map(templateById);
    templates.set('tpl-1', { ...mockTemplates[0], body: 'Hello school\n<a data-crm-portfolio="true" href="https://files.example.com/p.pdf">View portfolio</a>' });
    renderWithProviders(<SequenceMessagePreview sequence={mockSequence} templateById={templates} />);
    expect(screen.getByRole('link', { name: 'View portfolio' })).toHaveAttribute('href', 'https://files.example.com/p.pdf');
    expect(screen.getByText('Hello school')).toBeInTheDocument();
    expect(screen.queryByText(/data-crm-portfolio/)).not.toBeInTheDocument();
  });

  it('does not make an unsafe portfolio URL clickable', () => {
    const templates = new Map(templateById);
    templates.set('tpl-1', { ...mockTemplates[0], body: '<a data-crm-portfolio="true" href="javascript:alert(1)">View portfolio</a>' });
    renderWithProviders(<SequenceMessagePreview sequence={mockSequence} templateById={templates} />);
    expect(screen.queryByRole('link', { name: 'View portfolio' })).not.toBeInTheDocument();
  });

  it('can toggle hide/view message content', () => {
    renderWithProviders(
      <SequenceMessagePreview
        sequence={mockSequence}
        templateById={templateById}
        initiallyOpen={true}
      />,
    );

    expect(screen.getByText('Cold Email · Step 1 — Intro')).toBeInTheDocument();

    // Click Hide
    const toggleBtn = screen.getByRole('button', { name: /Hide message content/i });
    fireEvent.click(toggleBtn);

    expect(screen.queryByText('Cold Email · Step 1 — Intro')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View message content/i })).toBeInTheDocument();

    // Click View again
    fireEvent.click(screen.getByRole('button', { name: /View message content/i }));
    expect(screen.getByText('Cold Email · Step 1 — Intro')).toBeInTheDocument();
  });

  it('shows missing template alert when templateId does not exist', () => {
    const emptyMap = new Map<string, Template>();
    renderWithProviders(
      <SequenceMessagePreview
        sequence={mockSequence}
        templateById={emptyMap}
        initiallyOpen={true}
      />,
    );

    const alerts = screen.getAllByText(/No template attached or template was not found/i);
    expect(alerts.length).toBe(2);
  });

  it('renders nothing when sequence has no steps', () => {
    const emptySequence: Sequence = {
      ...mockSequence,
      steps: [],
    };
    renderWithProviders(
      <SequenceMessagePreview
        sequence={emptySequence}
        templateById={templateById}
      />,
    );
    expect(screen.queryByText(/Message Content Preview/i)).not.toBeInTheDocument();
  });
});
