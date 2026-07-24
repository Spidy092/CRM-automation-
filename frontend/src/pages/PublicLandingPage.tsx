import { useParams, useSearchParams } from 'react-router-dom';
import { usePublicPage, type PageBlock, type PublicFileRef } from '@/api/pages';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Download, FileText } from 'lucide-react';

function youtubeEmbedUrl(url: string): string | null {
  const watchMatch = url.match(/[?&]v=([\w-]{11})/);
  const shortMatch = url.match(/youtu\.be\/([\w-]{11})/);
  const id = watchMatch?.[1] ?? shortMatch?.[1];
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

function GalleryBlock({
  block,
  files,
}: {
  block: Extract<PageBlock, { type: 'gallery' }>;
  files: Record<string, PublicFileRef>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {block.fileIds.map((id) => {
        const file = files[id];
        if (!file) return null;
        return (
          <div key={id} className="aspect-square overflow-hidden rounded-lg bg-slate-100">
            <img src={file.url} alt="" className="h-full w-full object-cover" />
          </div>
        );
      })}
    </div>
  );
}

function LinkBlock({ block }: { block: Extract<PageBlock, { type: 'link' }> }) {
  return (
    <a
      href={block.url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
    >
      {block.label}
    </a>
  );
}

function AttachmentBlock({
  block,
  files,
}: {
  block: Extract<PageBlock, { type: 'attachment' }>;
  files: Record<string, PublicFileRef>;
}) {
  const file = files[block.fileId];
  if (!file) return null;
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-slate-200 p-3 text-sm text-slate-700 hover:bg-slate-50"
    >
      <FileText className="h-4 w-4 shrink-0 text-slate-500" />
      <span className="flex-1">{block.label || file.filename}</span>
      <Download className="h-4 w-4 shrink-0 text-slate-400" />
    </a>
  );
}

function VideoBlock({ block }: { block: Extract<PageBlock, { type: 'video' }> }) {
  const embedUrl = youtubeEmbedUrl(block.youtubeUrl);
  if (!embedUrl) return null;
  return (
    <div className="aspect-video overflow-hidden rounded-lg">
      <iframe
        src={embedUrl}
        title="Video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="h-full w-full"
      />
    </div>
  );
}

function MapBlock({ block }: { block: Extract<PageBlock, { type: 'map' }> }) {
  return (
    <div className="aspect-video overflow-hidden rounded-lg">
      <iframe
        src={`https://www.google.com/maps?q=${encodeURIComponent(block.address)}&output=embed`}
        title="Map"
        className="h-full w-full border-0"
        loading="lazy"
      />
    </div>
  );
}

export function PublicLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const leadId = searchParams.get('lead') ?? undefined;
  const { data: page, isLoading, isError } = usePublicPage(slug ?? '', leadId);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Page not found</h1>
          <p className="mt-2 text-sm text-slate-500">
            This page doesn't exist or hasn't been published yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-16">
        <h1 className="text-3xl font-bold text-slate-900">{page.title}</h1>
        {page.description && (
          <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-700">
            {page.description}
          </p>
        )}
        {page.blocks.map((block, index) => {
          const key = `${block.type}-${index}`;
          if (block.type === 'gallery') return <GalleryBlock key={key} block={block} files={page.files} />;
          if (block.type === 'link') return <LinkBlock key={key} block={block} />;
          if (block.type === 'attachment')
            return <AttachmentBlock key={key} block={block} files={page.files} />;
          if (block.type === 'video') return <VideoBlock key={key} block={block} />;
          return <MapBlock key={key} block={block} />;
        })}
      </div>
    </div>
  );
}
