import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/EmptyState';
import { renderDesignPreview, starterTemplates, type StarterTemplate } from '@/lib/emailDesign';
import { Eye, FilePlus, LayoutGrid, Search, X } from 'lucide-react';

/**
 * Built-in starter gallery. Each card offers Preview (sandboxed iframe with
 * fictional sample values) and Use (opens the visual editor prefilled — the
 * original starter is never modified).
 */
export function StarterGallery() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const starters = starterTemplates();
  const filtered = starters.filter((s) =>
    !search.trim() ||
    `${s.name} ${s.description}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const previewed: StarterTemplate | undefined = starters.find((s) => s.key === previewKey);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input placeholder="Search starters…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" aria-label="Search starter templates" />
      </div>
      {filtered.length === 0 && (
        <EmptyState icon={<LayoutGrid className="h-6 w-6" />} title="No starters match" description="Try a different search term." />
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => (
          <Card key={s.key} className="flex flex-col overflow-hidden">
            <div className="max-h-44 overflow-hidden border-b border-slate-100 bg-slate-50" aria-hidden="true">
              <div className="pointer-events-none origin-top scale-[0.55]" style={{ width: '182%' }}>
                <div dangerouslySetInnerHTML={{ __html: renderDesignPreview(s.design) }} />
              </div>
            </div>
            <CardContent className="flex flex-1 flex-col gap-2 pt-4">
              <h3 className="font-medium text-slate-900">{s.name}</h3>
              <p className="flex-1 text-sm text-slate-500">{s.description}</p>
              <p className="truncate text-xs text-slate-400">Subject: {s.subject}</p>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setPreviewKey(s.key)}>
                  <Eye className="mr-1 h-3.5 w-3.5" />Preview
                </Button>
                <Button size="sm" className="flex-1" onClick={() => navigate(`/templates/new?starter=${s.key}&channel=email&mode=visual`)}>
                  <FilePlus className="mr-1 h-3.5 w-3.5" />Use
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {previewed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewKey(null)} role="dialog" aria-modal="true" aria-label={`Preview ${previewed.name}`}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">{previewed.name}</h3>
                <p className="text-xs text-slate-500">Starter preview with fictional samples. Subject: {previewed.subject}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setPreviewKey(null)} aria-label="Close starter preview"><X className="h-4 w-4" /></Button>
            </div>
            <div className="overflow-y-auto bg-slate-100 p-4">
              <iframe sandbox="" srcDoc={renderDesignPreview(previewed.design)} title={`${previewed.name} starter preview (isolated)`} className="h-[480px] w-full rounded border-0 bg-white" />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setPreviewKey(null)}>Close</Button>
              <Button size="sm" onClick={() => navigate(`/templates/new?starter=${previewed.key}&channel=email&mode=visual`)}>
                <FilePlus className="mr-1 h-3.5 w-3.5" />Use this starter
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
