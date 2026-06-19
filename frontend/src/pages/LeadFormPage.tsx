import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLead, useCreateLead, useUpdateLead } from '@/api/leads';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import type { LeadInput } from '@/types';

export function LeadFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: lead, isLoading: isLoadingLead } = useLead(id || '');
  const createLead = useCreateLead();
  const updateLead = useUpdateLead();

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
    tags: [],
    notes: null,
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
        tags: lead.tags,
        notes: lead.notes,
      }));
    }
  }, [lead, isEditing]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value === '' ? null : value,
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
    } catch (error) {
      console.error('Failed to save lead:', error);
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

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-gray-900">
        {isEditing ? 'Edit Lead' : 'Add New Lead'}
      </h1>

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
    </div>
  );
}
