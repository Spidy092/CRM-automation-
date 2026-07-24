import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, AlertCircle, Globe, Share2, Search } from 'lucide-react';
import type { PageBlock } from '@/api/pages';
import type { LibraryFile } from '@/api/files';

interface Props {
  title: string;
  slug: string;
  description: string;
  blocks: PageBlock[];
  filesById: Map<string, LibraryFile>;
}

export function SeoSocialPreviewCard({ title, slug, description, blocks, filesById }: Props) {
  const [activeTab, setActiveTab] = useState<'google' | 'social'>('google');

  const displayTitle = title.trim() || 'Untitled Page';
  const displaySlug = slug.trim() || 'my-landing-page';
  const displayDesc =
    description.trim() || 'Add a page description to improve search engine rankings & social media click-throughs.';
  const domain = window.location.hostname || 'yourcrm.io';

  // Find image preview from gallery/attachment blocks
  let imageUrl: string | null = null;
  for (const block of blocks) {
    if (block.type === 'gallery' && block.fileIds.length > 0) {
      const file = filesById.get(block.fileIds[0]);
      if (file && file.mime_type.startsWith('image/')) {
        imageUrl = file.url;
        break;
      }
    } else if (block.type === 'attachment' && block.fileId) {
      const file = filesById.get(block.fileId);
      if (file && file.mime_type.startsWith('image/')) {
        imageUrl = file.url;
        break;
      }
    }
  }

  // SEO Score Checks
  const titleLength = displayTitle.length;
  const descLength = displayDesc.length;

  const isTitleGood = titleLength >= 15 && titleLength <= 60;
  const isDescGood = descLength >= 50 && descLength <= 160;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Globe className="h-4 w-4 text-indigo-600" />
            SEO & OpenGraph Social Preview
          </CardTitle>
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('google')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === 'google' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Search className="h-3 w-3" />
              Google SERP
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('social')}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTab === 'social' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <Share2 className="h-3 w-3" />
              Social Card
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {activeTab === 'google' ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 font-sans shadow-2xs">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{domain}</span>
              <span>› p › {displaySlug}</span>
            </div>
            <h4 className="mt-1 text-lg font-medium text-blue-700 hover:underline cursor-pointer truncate">
              {displayTitle}
            </h4>
            <p className="mt-1 text-xs text-slate-600 line-clamp-2 leading-relaxed">{displayDesc}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xs">
            {imageUrl ? (
              <img src={imageUrl} alt="" className="h-36 w-full object-cover" />
            ) : (
              <div className="flex h-32 w-full items-center justify-center bg-slate-100 text-xs text-slate-400">
                Add an Image Gallery or Attachment block to display a social card thumbnail
              </div>
            )}
            <div className="p-3 bg-slate-50 border-t border-slate-100">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{domain}</span>
              <h5 className="text-sm font-semibold text-slate-900 truncate mt-0.5">{displayTitle}</h5>
              <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{displayDesc}</p>
            </div>
          </div>
        )}

        {/* Real-time SEO Audit Checklist */}
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isTitleGood ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              )}
              <span className="font-medium text-slate-700">Title Length</span>
            </div>
            <span className="text-slate-500 font-mono">{titleLength} / 60 chars</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isDescGood ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
              )}
              <span className="font-medium text-slate-700">Meta Description</span>
            </div>
            <span className="text-slate-500 font-mono">{descLength} / 160 chars</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
