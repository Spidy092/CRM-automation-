import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useVariants,
  useABTestReport,
  useCreateVariant,
  useDeleteVariant,
  usePromoteWinner,
  useRecordSnapshots,
  type CampaignVariant,
  type VariantMetrics,
} from '@/api/abTesting';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingTable } from '@/components/ui/LoadingTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  FlaskConical,
  Trophy,
  ArrowLeft,
  Plus,
  Trash2,
  BarChart3,
} from 'lucide-react';

export function ABTestPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [campaignId, setCampaignId] = useState('');
  const [showNewVariant, setShowNewVariant] = useState(false);
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantKey, setNewVariantKey] = useState('');
  const [newVariantPct, setNewVariantPct] = useState(50);

  const { data: variants, isLoading: loadingVariants } = useVariants(campaignId);
  const { data: report, isLoading: loadingReport } = useABTestReport(campaignId);
  const createVariant = useCreateVariant();
  const deleteVariant = useDeleteVariant();
  const promoteWinner = usePromoteWinner();
  const recordSnapshots = useRecordSnapshots();

  const variantList = variants?.data ?? [];
  const r = report?.data;

  const handleCreateVariant = async () => {
    if (!newVariantName.trim() || !newVariantKey.trim()) {
      showToast('Name and key are required', 'error');
      return;
    }
    try {
      await createVariant.mutateAsync({
        campaignId,
        data: {
          name: newVariantName.trim(),
          variantKey: newVariantKey.trim(),
          templateId: '', // user selects from template picker in a real UI
          splitPct: newVariantPct,
        },
      });
      showToast('Variant created', 'success');
      setShowNewVariant(false);
      setNewVariantName('');
      setNewVariantKey('');
      setNewVariantPct(50);
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to create variant'), 'error');
    }
  };

  const handleDeleteVariant = async (id: string, name: string) => {
    if (!confirm(`Delete variant "${name}"?`)) return;
    try {
      await deleteVariant.mutateAsync(id);
      showToast('Variant deleted', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to delete variant'), 'error');
    }
  };

  const handlePromoteWinner = async () => {
    if (!campaignId) return;
    try {
      const result = await promoteWinner.mutateAsync(campaignId);
      if (result.data.promoted) {
        showToast('Winner promoted to full campaign template', 'success');
      } else {
        showToast('No winner determined yet', 'success');
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to promote winner'), 'error');
    }
  };

  const handleRecordSnapshots = async () => {
    if (!campaignId) return;
    try {
      await recordSnapshots.mutateAsync(campaignId);
      showToast('Snapshots recorded', 'success');
    } catch (err) {
      showToast(getApiErrorMessage(err, 'Failed to record snapshots'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="A/B Testing"
        description="Compare message variants and auto-promote the winner"
        actions={
          <Button variant="outline" onClick={() => navigate('/campaigns')}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Campaigns
          </Button>
        }
      />

      {/* Campaign ID input */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-end gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="campaign-id">Campaign ID</Label>
              <Input
                id="campaign-id"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
                placeholder="Enter campaign UUID to view A/B test data"
              />
            </div>
            <Button disabled={!campaignId}>Load</Button>
          </div>
        </CardContent>
      </Card>

      {campaignId && (loadingVariants || loadingReport) && <LoadingTable rows={3} cols={4} />}

      {campaignId && !loadingVariants && !loadingReport && (
        <>
          {/* Report summary */}
          {r && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-slate-500">Variants</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{variantList.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-slate-500">Total Sent</p>
                  <p className="mt-1 text-3xl font-bold text-slate-900">{r.totalSent}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-slate-500">Statistical Significance</p>
                  <p className={`mt-1 text-3xl font-bold ${r.isSignificant ? 'text-green-600' : 'text-amber-600'}`}>
                    {r.isSignificant ? 'Yes' : 'No'}
                  </p>
                  {r.pValue !== null && (
                    <p className="mt-1 text-xs text-slate-500">p = {r.pValue.toFixed(4)}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <p className="text-sm text-slate-500">Winner</p>
                  {r.winner ? (
                    <div className="mt-1 flex items-center gap-2">
                      <Trophy className="h-5 w-5 text-amber-500" />
                      <span className="text-lg font-bold text-slate-900">{r.winner.variant.name}</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-lg text-slate-400">TBD</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Variants list */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Variants</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleRecordSnapshots}>
                <BarChart3 className="mr-1 h-3 w-3" /> Record Snapshot
              </Button>
              <Button size="sm" onClick={handlePromoteWinner} disabled={promoteWinner.isPending}>
                <Trophy className="mr-1 h-3 w-3" /> Promote Winner
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowNewVariant(!showNewVariant)}>
                <Plus className="mr-1 h-3 w-3" /> Add Variant
              </Button>
            </div>
          </div>

          {/* New variant form */}
          {showNewVariant && (
            <Card className="border-indigo-200 bg-indigo-50">
              <CardContent className="p-4">
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={newVariantName} onChange={(e) => setNewVariantName(e.target.value)} placeholder="Variant B" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Key</Label>
                    <Input value={newVariantKey} onChange={(e) => setNewVariantKey(e.target.value)} placeholder="variant_b" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Split %</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={newVariantPct}
                      onChange={(e) => setNewVariantPct(Number(e.target.value))}
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <Button size="sm" onClick={handleCreateVariant} disabled={createVariant.isPending}>
                      Create
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setShowNewVariant(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Variant cards */}
          {variantList.length === 0 ? (
            <EmptyState
              icon={<FlaskConical className="h-6 w-6" />}
              title="No variants yet"
              description="Create at least two variants to start an A/B test."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {variantList.map((v: CampaignVariant) => {
                const variantResult = r?.variants.find((vr) => vr.variant.id === v.id);
                const m = variantResult?.metrics as VariantMetrics | undefined;
                const isWinner = r?.winner?.variant.id === v.id;
                return (
                  <Card key={v.id} className={isWinner ? 'border-amber-300 bg-amber-50/50' : ''}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-slate-900">{v.name}</h4>
                            {isWinner && <Trophy className="h-4 w-4 text-amber-500" />}
                            <StatusBadge tone={v.status === 'active' ? 'green' : 'gray'}>
                              {v.status}
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">Key: {v.variant_key} · Split: {v.split_pct}%</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => handleDeleteVariant(v.id, v.name)}
                          disabled={deleteVariant.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>

                      {m && (
                        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                          <div>
                            <p className="text-xs text-slate-500">Sent</p>
                            <p className="text-lg font-bold text-slate-900">{m.sent}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Open Rate</p>
                            <p className="text-lg font-bold text-indigo-600">{m.openRate.toFixed(1)}%</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Click Rate</p>
                            <p className="text-lg font-bold text-indigo-600">{m.clickRate.toFixed(1)}%</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
