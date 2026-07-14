import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useImportLeads } from '@/api/leads';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import type { ImportSummary } from '@/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upload, FileText } from 'lucide-react';

export function ImportLeadsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('manual');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const importLeads = useImportLeads();
  const { showToast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setSummary(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    try {
      const result = await importLeads.mutateAsync({ file, source });
      setSummary(result);
      const created = result.created + result.updated;
      showToast(
        result.failed > 0
          ? `Imported ${created} leads, ${result.failed} failed. See details below.`
          : `Imported ${created} leads successfully.`,
        result.failed > 0 && created === 0 ? 'error' : 'success',
      );
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Import failed. Please check the file and try again.'), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Import Leads" eyebrow="Leads" />

      <Card>
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
          <CardDescription>
            Import leads from CSV or Excel files. The file should contain columns for business_name,
            contact_name, email, phone, industry, location, and source_platform. Any other columns will be automatically mapped to your Custom Fields.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="source">Default Source Platform</Label>
              <select
                id="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="manual">Manual Upload</option>
                <option value="google_business">Google Business</option>
                <option value="facebook">Facebook</option>
                <option value="youtube">YouTube</option>
                <option value="google_ads">Google Ads</option>
                <option value="website">Website Form</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file">File</Label>
              <div
                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors hover:border-slate-400"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mb-4 h-8 w-8 text-slate-400" />
                <p className="mb-2 text-sm text-slate-600">
                  Click to upload or drag and drop
                </p>
                <p className="text-xs text-slate-500">CSV, XLSX, or XLS</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
              {file && (
                <div className="flex items-center rounded-md bg-slate-50 p-3">
                  <FileText className="mr-2 h-4 w-4 text-slate-500" />
                  <span className="text-sm text-slate-700">{file.name}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-4">
              <Button type="button" variant="outline" onClick={() => navigate('/leads')}>
                Cancel
              </Button>
              <Button type="submit" disabled={!file || importLeads.isPending}>
                {importLeads.isPending ? 'Importing...' : 'Import Leads'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {summary && (
        <Card>
          <CardHeader>
            <CardTitle>Import Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-4 text-center">
                <div className="text-2xl font-bold">{summary.total}</div>
                <div className="text-sm text-slate-500">Total Rows</div>
              </div>
              <div className="rounded-lg bg-green-50 p-4 text-center">
                <div className="text-2xl font-bold text-green-600">{summary.created}</div>
                <div className="text-sm text-green-600">Created</div>
              </div>
              <div className="rounded-lg bg-blue-50 p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{summary.updated}</div>
                <div className="text-sm text-blue-600">Updated</div>
              </div>
              <div className="rounded-lg bg-red-50 p-4 text-center">
                <div className="text-2xl font-bold text-red-600">{summary.failed}</div>
                <div className="text-sm text-red-600">Failed</div>
              </div>
            </div>

            {summary.errors.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 font-medium text-slate-900">Errors</h3>
                <div className="max-h-60 overflow-y-auto rounded-lg border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        <th className="px-4 py-2 text-left text-sm font-medium text-slate-500">Row</th>
                        <th className="px-4 py-2 text-left text-sm font-medium text-slate-500">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.errors.map((error, index) => (
                        <tr key={index} className="border-b">
                          <td className="px-4 py-2 text-sm text-slate-700">{error.row}</td>
                          <td className="px-4 py-2 text-sm text-red-600">{error.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <Button onClick={() => navigate('/leads')}>View Leads</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
