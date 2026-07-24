import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLead, useCreateLead, useUpdateLead, usePauseLead } from '@/api/leads';
import { useCampaigns } from '@/api/campaigns';
import { useSequences, useManualOutreachSend } from '@/api/outreach';
import { usePipelines } from '@/api/pipelines';
import { useTemplates } from '@/api/templates';
import { useCustomFields } from '@/api/customFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { LeadTimeline } from '@/components/LeadTimeline';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pause, Play, Send } from 'lucide-react';
import type { LeadInput } from '@/types';

export function LeadFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: lead, isLoading: isLoadingLead } = useLead(id || '');
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();
  const pauseLead = usePauseLead();
  const manualSend = useManualOutreachSend();
  const { data: campaigns = [] } = useCampaigns();
  const { data: sequenceData } = useSequences();
  const { data: pipelines } = usePipelines();
  const { data: templates = [] } = useTemplates({ approval_status: 'approved' });
  const { data: customFields = [] } = useCustomFields();

  const [manualSendData, setManualSendData] = useState({
    campaignId: '',
    sequenceId: '',
    channel: 'email' as 'whatsapp' | 'email' | 'sms' | 'phone_call',
    templateId: '',
  });

  const [formData, setFormData] = useState<LeadInput>({
    business_name: '',
    contact_name: '',
    phone: '',
    email: '',
    website: null,
    industry: '',
    location: '',
    country: null,
    google_rating: null,
    review_count: null,
    source_platform: 'manual',
    pipeline_stage_id: null,
    tags: [],
    notes: null,
    deal_value: null,
    custom_fields: {},
  });

  useEffect(() => {
    if (lead && isEditing) {
      setFormData((prev) => ({
        ...prev,
        business_name: lead.business_name,
        contact_name: lead.contact_name,
        phone: lead.phone,
        email: lead.email,
        website: lead.website,
        industry: lead.industry,
        location: lead.location,
        country: lead.country,
        google_rating: lead.google_rating,
        review_count: lead.review_count,
        source_platform: lead.source_platform,
        pipeline_stage_id: lead.pipeline_stage_id,
        tags: lead.tags,
        notes: lead.notes,
        deal_value: lead.deal_value,
        custom_fields: lead.custom_fields || {},
      }));
    }
  }, [lead, isEditing]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value === '' ? null : (type === 'number' && value ? Number(value) : value),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (isEditing && id) {
        await updateLead.mutateAsync({ id, input: formData });
        showToast('Lead updated successfully.', 'success');
      } else {
        await createLead.mutateAsync(formData);
        showToast('Lead created successfully.', 'success');
      }
      navigate('/leads');
    } catch {
      showToast(
        isEditing ? 'Failed to update lead. Please try again.' : 'Failed to create lead. Please try again.',
        'error'
      );
    }
  };

  if (isEditing && isLoadingLead) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <Card>
          <CardHeader>
            <Skeleton className="mb-2 h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isPaused = lead?.status === 'paused';
  const sequences = (sequenceData as { items?: Array<{ id: string; name: string }> } | undefined)?.items ?? [];
  const approvedTemplates = templates.filter((template) => template.channel === manualSendData.channel);

  const handleManualSend = async () => {
    if (!id) return;
    try {
      await manualSend.mutateAsync({
        leadId: id,
        campaignId: manualSendData.campaignId,
        sequenceId: manualSendData.sequenceId,
        stepNumber: 1,
        channel: manualSendData.channel,
        templateId: manualSendData.templateId,
      });
      showToast('Manual send queued.', 'success');
    } catch {
      showToast('Manual send was blocked. Check campaign, template, and lead status.', 'error');
    }
  };

  const handleTogglePause = async () => {
    if (!id || !lead) return;
    if (lead.status !== 'active' && lead.status !== 'paused') return;
    const willPause = lead.status === 'active';
    try {
      await pauseLead.mutateAsync({ id, paused: willPause });
      showToast(
        willPause ? 'Automation paused.' : 'Automation resumed.',
        'success',
      );
    } catch {
      showToast('Failed to update automation status.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEditing ? 'Edit Lead' : 'Add New Lead'}
        eyebrow="Leads"
        actions={
          isEditing && lead && (lead.status === 'active' || lead.status === 'paused') ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTogglePause}
              disabled={pauseLead.isPending}
              className={isPaused ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50'}
            >
              {isPaused ? (
                <>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Resume Automation
                </>
              ) : (
                <>
                  <Pause className="mr-1.5 h-3.5 w-3.5" />
                  Pause Automation
                </>
              )}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Lead Information</CardTitle>
          <CardDescription>
            {isEditing ? 'Update the lead details' : 'Enter the lead details to create a new lead'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="business_name">Business Name *</Label>
                <Input
                  id="business_name"
                  name="business_name"
                  value={formData.business_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contact_name">Contact Name *</Label>
                <Input
                  id="contact_name"
                  name="contact_name"
                  value={formData.contact_name}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lf-email">Email *</Label>
                <Input
                  id="lf-email"
                  name="email"
                  type="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  name="website"
                  value={formData.website || ''}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industry *</Label>
                <Input
                  id="industry"
                  name="industry"
                  value={formData.industry}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location">Location *</Label>
                <Input
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  name="country"
                  value={formData.country || ''}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="pipeline_stage_id">Pipeline Stage</Label>
                <select
                  id="pipeline_stage_id"
                  name="pipeline_stage_id"
                  value={formData.pipeline_stage_id || ''}
                  onChange={handleChange}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="">None (No Pipeline Assigned)</option>
                  {pipelines?.map((p) => (
                    <optgroup key={p.id} label={p.name}>
                      {p.stages?.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="deal_value">Deal Value ($)</Label>
                <Input
                  id="deal_value"
                  name="deal_value"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.deal_value || ''}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="google_rating">Google Rating (0–5)</Label>
                <Input
                  id="google_rating"
                  name="google_rating"
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={formData.google_rating ?? ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? null : parseFloat(e.target.value);
                    setFormData((prev) => ({ ...prev, google_rating: value }));
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="review_count">Review Count</Label>
                <Input
                  id="review_count"
                  name="review_count"
                  type="number"
                  min="0"
                  value={formData.review_count ?? ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? null : parseInt(e.target.value);
                    setFormData((prev) => ({ ...prev, review_count: value }));
                  }}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tags">Tags (comma-separated)</Label>
              <Input
                id="tags"
                name="tags"
                value={formData.tags?.join(', ') || ''}
                onChange={(e) => {
                  const tags = e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean);
                  setFormData((prev) => ({ ...prev, tags }));
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                name="notes"
                value={formData.notes || ''}
                onChange={handleChange}
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {customFields.length > 0 && (
              <div className="space-y-4 pt-4 border-t border-slate-200">
                <h3 className="text-lg font-semibold text-slate-900">Custom Fields</h3>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  {customFields.map((field) => (
                    <div key={field.id} className="space-y-2">
                      <Label htmlFor={`cf-${field.field_key}`}>
                        {field.label} {field.is_required && '*'}
                      </Label>
                      {field.field_type === 'dropdown' ? (
                        <select
                          id={`cf-${field.field_key}`}
                          value={(formData.custom_fields?.[field.field_key] as string) || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormData((prev) => ({
                              ...prev,
                              custom_fields: {
                                ...(prev.custom_fields || {}),
                                [field.field_key]: val === '' ? null : val,
                              },
                            }));
                          }}
                          required={field.is_required}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="">Select option</option>
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : field.field_type === 'checkbox' ? (
                        <div className="flex items-center space-x-2 pt-2">
                          <input
                            type="checkbox"
                            id={`cf-${field.field_key}`}
                            checked={!!formData.custom_fields?.[field.field_key]}
                            onChange={(e) => {
                              const val = e.target.checked;
                              setFormData((prev) => ({
                                ...prev,
                                custom_fields: {
                                  ...(prev.custom_fields || {}),
                                  [field.field_key]: val,
                                },
                              }));
                            }}
                            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                          />
                        </div>
                      ) : (
                        <Input
                          id={`cf-${field.field_key}`}
                          type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
                          value={(formData.custom_fields?.[field.field_key] as string | number) || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setFormData((prev) => ({
                              ...prev,
                              custom_fields: {
                                ...(prev.custom_fields || {}),
                                [field.field_key]: val === '' ? null : field.field_type === 'number' ? Number(val) : val,
                              },
                            }));
                          }}
                          required={field.is_required}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => navigate('/leads')}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createLead.isPending || updateLead.isPending}
              >
                {createLead.isPending || updateLead.isPending
                  ? 'Saving…'
                  : isEditing
                  ? 'Update Lead'
                  : 'Create Lead'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {isEditing && id && (
        <Card>
          <CardHeader>
            <CardTitle>Manual Guarded Send</CardTitle>
            <CardDescription>Queue a one-off approved-template dispatch for recovery.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <select
                value={manualSendData.campaignId}
                onChange={(e) => setManualSendData((prev) => ({ ...prev, campaignId: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                ))}
              </select>
              <select
                value={manualSendData.sequenceId}
                onChange={(e) => setManualSendData((prev) => ({ ...prev, sequenceId: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Sequence</option>
                {sequences.map((sequence) => (
                  <option key={sequence.id} value={sequence.id}>{sequence.name}</option>
                ))}
              </select>
              <select
                value={manualSendData.channel}
                onChange={(e) => setManualSendData((prev) => ({ ...prev, channel: e.target.value as typeof prev.channel, templateId: '' }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="phone_call">Phone Call</option>
              </select>
              <select
                value={manualSendData.templateId}
                onChange={(e) => setManualSendData((prev) => ({ ...prev, templateId: e.target.value }))}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Approved template</option>
                {approvedTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex flex-col items-end gap-1">
              {(() => {
                const hasChannelDestination = Boolean(
                  manualSendData.channel === 'email'
                    ? (formData.email || lead?.email || '').trim()
                    : (formData.phone || lead?.phone || '').trim()
                );
                return (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleManualSend}
                      disabled={
                        manualSend.isPending ||
                        !manualSendData.campaignId ||
                        !manualSendData.sequenceId ||
                        !manualSendData.templateId ||
                        !hasChannelDestination ||
                        lead?.status !== 'active'
                      }
                      title={
                        lead?.status !== 'active'
                          ? 'Lead status must be active to queue a manual send'
                          : !hasChannelDestination
                          ? `Selected channel (${manualSendData.channel}) requires a ${manualSendData.channel === 'email' ? 'valid email address' : 'valid phone number'}`
                          : !manualSendData.campaignId || !manualSendData.sequenceId || !manualSendData.templateId
                          ? 'Please select a campaign, sequence, and approved template'
                          : 'Queue a manual send for this lead'
                      }
                    >
                      <Send className="mr-2 h-4 w-4" />
                      Queue Send
                    </Button>
                    {lead?.status !== 'active' && (
                      <span className="text-xs text-amber-600">Manual send requires an active lead status.</span>
                    )}
                    {lead?.status === 'active' && !hasChannelDestination && (
                      <span className="text-xs text-amber-600">
                        Selected channel ({manualSendData.channel}) requires a {manualSendData.channel === 'email' ? 'valid email address' : 'valid phone number'}.
                      </span>
                    )}
                    {lead?.status === 'active' && hasChannelDestination && (!manualSendData.campaignId || !manualSendData.sequenceId || !manualSendData.templateId) && (
                      <span className="text-xs text-slate-500">Select a campaign, sequence, and approved template to enable send.</span>
                    )}
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity timeline — only shown when editing an existing lead */}
      {isEditing && id && (
        <Card>
          <CardHeader>
            <CardTitle>Activity &amp; Outreach History</CardTitle>
            <CardDescription>
              Full communication history and outreach log for this lead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LeadTimeline leadId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
