import { useState } from 'react';
import { usePipelines, useCreatePipeline, useUpdatePipeline, useDeletePipeline } from '@/api/pipelines';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import { Plus, Trash2, GripVertical } from 'lucide-react';

interface StageInput {
  name: string;
  position: number;
  is_terminal_won: boolean;
  is_terminal_lost: boolean;
}

export function PipelinePage() {
  const { data: pipelines, isLoading } = usePipelines();
  const createPipeline = useCreatePipeline();
  const updatePipeline = useUpdatePipeline();
  const deletePipeline = useDeletePipeline();
  const { showToast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pipelineName, setPipelineName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [stages, setStages] = useState<StageInput[]>([
    { name: 'New Lead', position: 0, is_terminal_won: false, is_terminal_lost: false },
    { name: 'Contacted', position: 1, is_terminal_won: false, is_terminal_lost: false },
    { name: 'Qualified', position: 2, is_terminal_won: false, is_terminal_lost: false },
    { name: 'Proposal', position: 3, is_terminal_won: false, is_terminal_lost: false },
    { name: 'Won', position: 4, is_terminal_won: true, is_terminal_lost: false },
  ]);

  const handleAddStage = () => {
    setStages([
      ...stages,
      {
        name: '',
        position: stages.length,
        is_terminal_won: false,
        is_terminal_lost: false,
      },
    ]);
  };

  const handleRemoveStage = (index: number) => {
    const newStages = stages.filter((_, i) => i !== index);
    setStages(newStages.map((s, i) => ({ ...s, position: i })));
  };

  const handleStageChange = (index: number, field: keyof StageInput, value: unknown) => {
    let newStages = [...stages];
    
    if (field === 'is_terminal_won' && value === true) {
      newStages = newStages.map((stage, i) => 
        i === index 
          ? { ...stage, is_terminal_won: true, is_terminal_lost: false } 
          : { ...stage, is_terminal_won: false }
      );
    } else if (field === 'is_terminal_lost' && value === true) {
      newStages = newStages.map((stage, i) => 
        i === index 
          ? { ...stage, is_terminal_lost: true, is_terminal_won: false } 
          : { ...stage, is_terminal_lost: false }
      );
    } else {
      newStages[index] = { ...newStages[index], [field]: value };
    }
    
    setStages(newStages);
  };

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setPipelineName('');
    setIsDefault(false);
    setStages([
      { name: 'New Lead', position: 0, is_terminal_won: false, is_terminal_lost: false },
      { name: 'Contacted', position: 1, is_terminal_won: false, is_terminal_lost: false },
      { name: 'Qualified', position: 2, is_terminal_won: false, is_terminal_lost: false },
      { name: 'Proposal', position: 3, is_terminal_won: false, is_terminal_lost: false },
      { name: 'Won', position: 4, is_terminal_won: true, is_terminal_lost: false },
    ]);
  };

  const handleEdit = (pipeline: { id: string; name: string; is_default: boolean; stages?: Array<{ name: string; position: number; is_terminal_won: boolean; is_terminal_lost: boolean }> }) => {
    setEditingId(pipeline.id);
    setPipelineName(pipeline.name);
    setIsDefault(pipeline.is_default);
    if (pipeline.stages) {
      setStages(pipeline.stages.map((s, i) => ({ ...s, position: i })));
    }
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updatePipeline.mutateAsync({
          id: editingId,
          input: { name: pipelineName, is_default: isDefault },
        });
      } else {
        await createPipeline.mutateAsync({
          name: pipelineName,
          is_default: isDefault,
          stages,
        });
      }
      showToast(editingId ? 'Pipeline updated.' : 'Pipeline created.', 'success');
      resetForm();
    } catch (error) {
      showToast(
        getApiErrorMessage(error, `Failed to ${editingId ? 'update' : 'create'} pipeline.`),
        'error',
      );
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this pipeline?')) return;
    try {
      await deletePipeline.mutateAsync(id);
      showToast('Pipeline deleted.', 'success');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Failed to delete pipeline.'), 'error');
    }
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Pipelines</h1>
        <Button onClick={() => (showForm ? resetForm() : setShowForm(true))}>
          <Plus className="mr-2 h-4 w-4" />
          Create Pipeline
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Edit Pipeline' : 'Create New Pipeline'}</CardTitle>
            <CardDescription>
              {editingId
                ? 'Update the pipeline name and default status'
                : 'Define your sales pipeline stages'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Pipeline Name</Label>
                  <Input
                    id="name"
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                    placeholder="e.g., Sales Pipeline"
                    required
                  />
                </div>
                <div className="flex items-center space-x-2 pt-6">
                  <input
                    type="checkbox"
                    id="is_default"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="is_default">Set as default pipeline</Label>
                </div>
              </div>

              {editingId && stages.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Current Stages</Label>
                  <span className="text-xs text-slate-400">Stage editing is not available in this view</span>
                </div>
                <div className="space-y-2">
                  {stages.map((stage, index) => (
                    <div key={index} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <GripVertical className="h-4 w-4 text-slate-300" />
                      <span className="flex-1 text-sm text-slate-600">{stage.name}</span>
                      <div className="flex gap-2 text-xs">
                        {stage.is_terminal_won && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 font-medium">Won</span>}
                        {stage.is_terminal_lost && <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 font-medium">Lost</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}

              {!editingId && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label>Stages</Label>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddStage}>
                    <Plus className="mr-1 h-3 w-3" />
                    Add Stage
                  </Button>
                </div>
                <div className="space-y-2">
                  {stages.map((stage, index) => (
                    <div key={index} className="flex items-center gap-2 rounded-lg border p-3">
                      <GripVertical className="h-4 w-4 text-gray-400" />
                      <Input
                        value={stage.name}
                        onChange={(e) => handleStageChange(index, 'name', e.target.value)}
                        placeholder="Stage name"
                        className="flex-1"
                        required
                      />
                      <div className="flex items-center space-x-2">
                        <label className="flex items-center space-x-1 text-sm">
                          <input type="checkbox" checked={stage.is_terminal_won} onChange={(e) => handleStageChange(index, 'is_terminal_won', e.target.checked)} className="h-3 w-3 rounded border-gray-300" />
                          <span>Won</span>
                        </label>
                        <label className="flex items-center space-x-1 text-sm">
                          <input type="checkbox" checked={stage.is_terminal_lost} onChange={(e) => handleStageChange(index, 'is_terminal_lost', e.target.checked)} className="h-3 w-3 rounded border-gray-300" />
                          <span>Lost</span>
                        </label>
                      </div>
                      <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveStage(index)} disabled={stages.length <= 1}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
              )}


              <div className="flex justify-end space-x-4">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={editingId ? updatePipeline.isPending : createPipeline.isPending}
                >
                  {editingId
                    ? updatePipeline.isPending
                      ? 'Saving...'
                      : 'Save Changes'
                    : createPipeline.isPending
                      ? 'Creating...'
                      : 'Create Pipeline'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {pipelines?.map((pipeline) => (
          <Card key={pipeline.id} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{pipeline.name}</CardTitle>
                {pipeline.is_default && (
                  <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800">
                    Default
                  </span>
                )}
              </div>
              <CardDescription>
                Created {new Date(pipeline.created_at).toLocaleDateString()}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" size="sm" onClick={() => handleEdit(pipeline)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(pipeline.id)}
                  disabled={pipeline.is_default}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {(!pipelines || pipelines.length === 0) && (
          <Card className="col-span-full">
            <CardContent className="flex h-40 items-center justify-center text-sm text-gray-500">
              No pipelines created yet. Create your first pipeline to get started.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
