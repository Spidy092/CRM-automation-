import { useFiles } from '@/api/files';
import { usePages } from '@/api/pages';
import { Card, CardContent } from '@/components/ui/card';
import { Eye, FileStack, HardDrive, Image as ImageIcon, Sparkles } from 'lucide-react';

export function UnifiedContentAnalyticsCard() {
  const { data: pages = [] } = usePages();
  const { data: files = [] } = useFiles();

  const publishedCount = pages.filter((p) => p.status === 'published').length;
  const draftCount = pages.filter((p) => p.status === 'draft').length;

  const totalBytes = files.reduce((acc, f) => acc + (f.size_bytes || 0), 0);
  const totalStorageMb = (totalBytes / (1024 * 1024)).toFixed(2);

  const imagesCount = files.filter((f) => f.mime_type.startsWith('image/')).length;
  const pdfsCount = files.filter((f) => f.mime_type.includes('pdf')).length;

  return (
    <Card className="border-indigo-100 bg-gradient-to-r from-indigo-50/50 via-purple-50/30 to-white shadow-sm">
      <CardContent className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-md">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Content Hub Overview</h3>
              <p className="text-xs text-slate-500">
                Live performance & storage metrics for marketing assets & landing copy.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <FileStack className="h-3.5 w-3.5 text-indigo-500" />
                <span>Pages</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-base font-bold text-slate-900">{pages.length}</span>
                <span className="text-[10px] font-medium text-emerald-600">
                  ({publishedCount} pub)
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
                <span>Media Assets</span>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-base font-bold text-slate-900">{files.length}</span>
                <span className="text-[10px] font-medium text-slate-500">
                  {imagesCount} img / {pdfsCount} pdf
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <HardDrive className="h-3.5 w-3.5 text-purple-500" />
                <span>Storage</span>
              </div>
              <div className="mt-1">
                <span className="text-base font-bold text-slate-900">{totalStorageMb} MB</span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200/80 bg-white p-2.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <Eye className="h-3.5 w-3.5 text-amber-500" />
                <span>Drafts</span>
              </div>
              <div className="mt-1">
                <span className="text-base font-bold text-amber-700">{draftCount} draft{draftCount === 1 ? '' : 's'}</span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
