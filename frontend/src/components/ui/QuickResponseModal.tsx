import React, { useMemo, useState } from 'react';
import { Button } from './button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useTemplates } from '@/api/templates';
import { useQuickSend } from '@/api/outreach';
import type { Lead, MessageChannel, Template } from '@/types';
import { Mail, MessageSquare, Smartphone, Search, X, ArrowLeft } from 'lucide-react';

interface Props {
  lead: Lead;
  onClose: () => void;
}

const channelOptions: Array<{
  channel: MessageChannel;
  label: string;
  icon: React.ReactNode;
  destination: (lead: Lead) => string;
}> = [
  { channel: 'whatsapp', label: 'WhatsApp', icon: <MessageSquare className="h-4 w-4" />, destination: (l) => (l.phone ?? '').trim() },
  { channel: 'sms', label: 'SMS', icon: <Smartphone className="h-4 w-4" />, destination: (l) => (l.phone ?? '').trim() },
  { channel: 'email', label: 'Email', icon: <Mail className="h-4 w-4" />, destination: (l) => (l.email ?? '').trim() },
];

function interpolateTemplate(templateText: string, lead: Lead): string {
  let body = templateText;
  const firstName = lead.contact_name?.trim().split(' ')[0] || lead.contact_name || '';
  const safeReplacements: Record<string, string | number | null | undefined> = {
    business_name: lead.business_name,
    company_name: lead.business_name,
    industry: lead.industry,
    location: lead.location,
    country: lead.country ?? '',
    rating: lead.google_rating ?? '',
    source_platform: lead.source_platform,
    classification: lead.classification ?? '',
    contact_name: lead.contact_name,
    client_name: lead.contact_name,
    first_name: firstName,
    phone: lead.phone,
    email: lead.email,
  };
  for (const [key, value] of Object.entries(safeReplacements)) {
    const doubleBraceRegex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
    const singleBraceRegex = new RegExp(`\\{${key}\\}`, 'g');
    body = body.replace(doubleBraceRegex, String(value ?? '')).replace(singleBraceRegex, String(value ?? ''));
  }
  return body;
}

export function QuickResponseModal({ lead, onClose }: Props) {
  const availableChannels = useMemo(
    () => channelOptions.filter((opt) => !!opt.destination(lead)),
    [lead],
  );

  const [channel, setChannel] = useState<MessageChannel | null>(availableChannels[0]?.channel ?? null);
  const [search, setSearch] = useState('');
  const [skipReview, setSkipReview] = useState(false);
  const [reviewTemplate, setReviewTemplate] = useState<Template | null>(null);

  const { data: templatesPage, isLoading: templatesLoading } = useTemplates({
    channel: channel ?? undefined,
    approval_status: 'approved',
  });
  const templates = (templatesPage ?? []).filter((t) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return t.name.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
  });

  const quickSend = useQuickSend();
  const { showToast } = useToast();

  const handleChannelChange = (next: MessageChannel) => {
    setChannel(next);
    setReviewTemplate(null);
  };

  const doSend = async (templateId: string) => {
    if (!channel) return;
    try {
      await quickSend.mutateAsync({ leadId: lead.id, channel, templateId });
      showToast('Message sent.');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send message.';
      showToast(message, 'error');
    }
  };

  const handleSelect = (template: Template) => {
    if (skipReview) {
      void doSend(template.id);
    } else {
      setReviewTemplate(template);
    }
  };

  const activeChannel = channelOptions.find((o) => o.channel === channel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex h-[560px] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Send Quick Response to</p>
            <h2 className="text-lg font-bold text-slate-900">{lead.business_name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {availableChannels.length === 0 ? (
          <div className="px-6 py-8">
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
              This lead has no phone number or email address on file.
            </p>
          </div>
        ) : reviewTemplate ? (
          <ReviewStep
            template={reviewTemplate}
            lead={lead}
            channelLabel={activeChannel?.label ?? ''}
            destination={activeChannel ? activeChannel.destination(lead) : ''}
            isSending={quickSend.isPending}
            onBack={() => setReviewTemplate(null)}
            onSend={() => doSend(reviewTemplate.id)}
          />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: channel picker */}
            <div className="w-56 shrink-0 border-r border-slate-100 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Sending via</p>
              <div className="space-y-1">
                {channelOptions.map((opt) => {
                  const dest = opt.destination(lead);
                  const isAvail = !!dest;
                  const isSelected = channel === opt.channel;
                  return (
                    <button
                      key={opt.channel}
                      type="button"
                      disabled={!isAvail}
                      onClick={() => handleChannelChange(opt.channel)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-slate-900 font-medium text-white'
                          : isAvail
                          ? 'text-slate-700 hover:bg-slate-100'
                          : 'cursor-not-allowed text-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        {opt.icon}
                        {opt.label}
                      </span>
                      {!isAvail && <span className="text-[10px] uppercase">N/A</span>}
                    </button>
                  );
                })}
              </div>

              <div className="mt-6 border-t border-slate-100 pt-4">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={skipReview}
                    onChange={(e) => setSkipReview(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                  Skip review step
                </label>
              </div>
            </div>

            {/* Right: template selector */}
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <div className="mb-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search approved templates..."
                    className="w-full rounded-md border border-slate-200 py-1.5 pl-9 pr-3 text-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {templatesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                ) : templates.length === 0 ? (
                  <p className="p-3 text-sm text-slate-400">
                    No approved {channel} templates match. Create and approve one in Content.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {templates.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-start justify-between gap-3 rounded-md border border-slate-200 p-3 hover:border-slate-300"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-slate-800">{t.name}</p>
                          <p className="line-clamp-2 text-xs text-slate-500">{t.body}</p>
                        </div>
                        <Button size="sm" onClick={() => handleSelect(t)} className="shrink-0">
                          Select
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  template,
  lead,
  channelLabel,
  destination,
  isSending,
  onBack,
  onSend,
}: {
  template: Template;
  lead: Lead;
  channelLabel: string;
  destination: string;
  isSending: boolean;
  onBack: () => void;
  onSend: () => void;
}) {
  const renderedSubject = template.subject ? interpolateTemplate(template.subject, lead) : null;
  const renderedBody = useMemo(() => interpolateTemplate(template.body, lead), [template.body, lead]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6">
        <p className="mb-3 text-sm text-slate-500">
          Sending via <span className="font-medium text-slate-700">{channelLabel}</span> to{' '}
          <span className="font-medium text-slate-700">{destination}</span>
        </p>
        {renderedSubject && (
          <p className="mb-2 text-sm">
            <span className="text-slate-500">Subject: </span>
            <span className="font-medium text-slate-800">{renderedSubject}</span>
          </p>
        )}
        <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          {renderedBody}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Previewing personalized text with lead details.
        </p>
      </div>
      <div className="flex justify-between gap-3 border-t border-slate-100 px-6 py-4">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSending}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button type="button" onClick={onSend} disabled={isSending}>
          {isSending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </div>
  );
}
