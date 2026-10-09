import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCreateTemplate, useUpdateTemplate } from '@/api/templates';
import { useFiles } from '@/api/files';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/lib/apiError';
import {
  BLOCK_DEFS,
  SAMPLE_VALUES,
  VARIABLE_CATALOG,
  collectDesignVariables,
  createBlock,
  defaultDesign,
  designFallbackText,
  renderDesignPreview,
  reusableSections,
  substituteSamples,
  type ColumnCell,
  type EmailBlock,
  type EmailBlockType,
  type EmailDesign,
  type StarterTemplate,
} from '@/lib/emailDesign';
import { TemplatePreviewModal, TestSendModal } from './TemplatePreviewModal';
import {
  ArrowDown, ArrowUp, Check, Copy, Eye, Loader2, Mail, Redo, Save, Trash2, Undo, X,
} from 'lucide-react';

export interface VisualEditorInitial {
  name: string;
  subject: string;
  preheader: string;
  design: EmailDesign;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Small variable-insert toolbar bound to a textarea/input ref. */
function VariableButtons({ targetRef, onInsert, label }: {
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  onInsert: (applied: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const insert = (name: string) => {
    const el = targetRef.current;
    const token = `{{${name}}}`;
    if (!el) {
      onInsert(token);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    onInsert(`${el.value.slice(0, start)}${token}${el.value.slice(end)}`);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
    setOpen(false);
  };
  return (
    <div className="relative inline-block">
      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={`${label} — insert personalization variable`}>
        {`{{}}`} Variables
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 max-h-56 w-52 overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg" role="menu" aria-label="Personalization variables">
          {VARIABLE_CATALOG.map((v) => (
            <button key={v} type="button" role="menuitem" onClick={() => insert(v)} className="block w-full rounded px-2 py-1 text-left font-mono text-xs text-slate-700 hover:bg-slate-100">
              {`{{${v}}}`}
            </button>
          ))}
          <p className="px-2 py-1 text-[11px] text-slate-400">Preview uses fictional samples, e.g. {SAMPLE_VALUES.first_name}.</p>
        </div>
      )}
    </div>
  );
}

function LabeledInput({ id, label, value, onChange, type = 'text', placeholder }: {
  id: string; label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="h-8 text-sm" />
    </div>
  );
}

function ImageLibraryPicker({ onSelect, onClose }: { onSelect: (url: string, alt: string) => void; onClose: () => void }) {
  const { data: files = [], isLoading } = useFiles();
  const images = files.filter((f) => f.mime_type.startsWith('image/'));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Choose image from media library">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">Choose image from media library</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close image picker"><X className="h-4 w-4" /></Button>
        </div>
        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {!isLoading && images.length === 0 && <p className="text-sm text-slate-500">No images in the library yet. Upload some from Content › Files first.</p>}
        <div className="grid grid-cols-3 gap-2">
          {images.map((f) => (
            <button key={f.id} type="button" onClick={() => onSelect(f.url, f.filename)} className="overflow-hidden rounded-md border border-slate-200 hover:ring-2 hover:ring-indigo-500" title={f.filename}>
              <img src={f.url} alt="" className="h-20 w-full object-cover" />
              <span className="block truncate px-1 py-0.5 text-[11px] text-slate-600">{f.filename}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CanvasBlockView({ block }: { block: EmailBlock }) {
  switch (block.type) {
    case 'text':
      return <div style={{ fontSize: block.props.fontSize, color: block.props.color, textAlign: block.props.align, fontWeight: block.props.bold ? 'bold' : undefined, fontStyle: block.props.italic ? 'italic' : undefined }} className="whitespace-pre-wrap break-words leading-relaxed">{block.props.text || <span className="text-slate-400">Empty text block</span>}</div>;
    case 'image':
      return block.props.src
        ? <div style={{ textAlign: block.props.align }}><img src={block.props.src} alt={block.props.alt} className="inline-block max-w-full rounded" /></div>
        : <div className="rounded bg-slate-100 px-4 py-8 text-center text-xs text-slate-500">Image placeholder — select this block and choose an image</div>;
    case 'button':
      return <div style={{ textAlign: block.props.align }}><span className="inline-block px-7 py-3 text-sm font-bold text-white" style={{ backgroundColor: block.props.backgroundColor, color: block.props.textColor, borderRadius: block.props.shape === 'pill' ? 999 : block.props.shape === 'rounded' ? 6 : 0 }}>{block.props.label || 'Button'}</span></div>;
    case 'divider':
      return <div style={{ padding: `${block.props.spacing}px 0` }}><hr style={{ borderTop: `${block.props.thickness}px solid ${block.props.color}` }} /></div>;
    case 'spacer':
      return <div className="rounded bg-slate-50 text-center text-[11px] text-slate-400" style={{ height: block.props.height }}>spacer · {block.props.height}px</div>;
    case 'columns': {
      const cell = (c: ColumnCell) => (
        <div className="min-w-0 flex-1 rounded bg-slate-50 p-2 text-sm">
          {c.imageSrc && <img src={c.imageSrc} alt={c.imageAlt} className="mb-1 max-w-full rounded" />}
          <div className="whitespace-pre-wrap break-words">{c.text || <span className="text-slate-400">Empty column</span>}</div>
          {c.buttonLabel && <div className="mt-1"><span className="inline-block rounded bg-indigo-700 px-3 py-1 text-xs font-bold text-white">{c.buttonLabel}</span></div>}
        </div>
      );
      return <div className="flex gap-2">{cell(block.props.left)}{block.props.columns === '2' && cell(block.props.right)}</div>;
    }
    case 'header':
      return <div className="rounded p-4 text-center" style={{ backgroundColor: block.props.backgroundColor }}><div className="text-[11px] uppercase tracking-wide text-slate-400">Header</div>{block.props.title && <div className="text-lg font-bold" style={{ color: block.props.textColor }}>{block.props.title}</div>}</div>;
    case 'footer':
      return <div className="rounded p-3 text-center text-xs" style={{ backgroundColor: block.props.backgroundColor, color: block.props.textColor }}><div className="whitespace-pre-wrap">{block.props.text}</div><div className="mt-1 underline">Unsubscribe</div></div>;
    case 'social':
      return <div className="text-center text-xs text-slate-500" style={{ textAlign: block.props.align }}>{block.props.links.length === 0 ? 'Social links placeholder — add links in settings' : block.props.links.map((l) => l.network).join(' · ')}</div>;
  }
}

export function VisualEmailEditor({ templateId, initial, starter, approvalStatus, onSaved }: {
  templateId?: string;
  initial?: VisualEditorInitial | null;
  starter?: StarterTemplate | null;
  approvalStatus?: string;
  onSaved?: (id: string) => void;
}) {
  const { showToast } = useToast();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();

  const seed = useMemo<VisualEditorInitial>(() => {
    if (initial) return clone(initial);
    if (starter) return { name: starter.name, subject: starter.subject, preheader: starter.preheader, design: clone(starter.design) };
    return { name: '', subject: '', preheader: '', design: defaultDesign() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [name, setName] = useState(seed.name);
  const [subject, setSubject] = useState(seed.subject);
  const [preheader, setPreheader] = useState(seed.preheader);
  const [design, setDesign] = useState<EmailDesign>(seed.design);
  const [past, setPast] = useState<EmailDesign[]>([]);
  const [future, setFuture] = useState<EmailDesign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>(templateId ? 'saved' : 'dirty');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const [imageTarget, setImageTarget] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const dirty = saveState === 'dirty' || saveState === 'error';
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const pushDesign = useCallback((next: EmailDesign) => {
    setPast((p) => [...p.slice(-49), design]);
    setFuture([]);
    setDesign(next);
    setSaveState('dirty');
  }, [design]);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [design, ...f].slice(0, 50));
      setDesign(prev);
      setSaveState('dirty');
      return p.slice(0, -1);
    });
  }, [design]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [next, ...rest] = f;
      setPast((p) => [...p.slice(-49), design]);
      setDesign(next);
      setSaveState('dirty');
      return rest;
    });
  }, [design]);

  const markDirty = () => setSaveState('dirty');

  const addBlock = (type: EmailBlockType) => {
    const block = createBlock(type);
    pushDesign({ ...design, blocks: [...design.blocks, block] });
    setSelectedId(block.id);
  };

  const addSection = (key: string) => {
    const section = reusableSections().find((s) => s.key === key);
    if (!section) return;
    pushDesign({ ...design, blocks: [...design.blocks, ...clone(section.blocks)] });
    showToast(`Section “${section.name}” added.`, 'success');
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= design.blocks.length) return;
    const blocks = [...design.blocks];
    const [moved] = blocks.splice(index, 1);
    blocks.splice(next, 0, moved);
    pushDesign({ ...design, blocks });
    setSelectedId(moved.id);
  };

  const duplicateBlock = (index: number) => {
    const src = design.blocks[index];
    const copy = { ...clone(src), id: `${src.id}-copy-${Date.now().toString(36)}` } as EmailBlock;
    const blocks = [...design.blocks];
    blocks.splice(index + 1, 0, copy);
    pushDesign({ ...design, blocks });
    setSelectedId(copy.id);
  };

  const removeBlock = (index: number) => {
    const target = design.blocks[index];
    if (target.type === 'footer' && design.blocks.filter((b) => b.type === 'footer').length === 1) {
      showToast('The last footer block cannot be removed — it carries the unsubscribe content.', 'error');
      return;
    }
    pushDesign({ ...design, blocks: design.blocks.filter((_, i) => i !== index) });
    setSelectedId(null);
  };

  const updateBlock = (id: string, updater: (b: EmailBlock) => EmailBlock) => {
    pushDesign({ ...design, blocks: design.blocks.map((b) => (b.id === id ? updater(clone(b)) : b)) });
  };

  const selectedIndex = design.blocks.findIndex((b) => b.id === selectedId);
  const selected = selectedIndex >= 0 ? design.blocks[selectedIndex] : null;

  const detectedVars = useMemo(
    () => Array.from(new Set([...collectDesignVariables(design), ...extractVars(subject)])),
    [design, subject],
  );

  function extractVars(s: string): string[] {
    const out: string[] = [];
    for (const m of s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) out.push(m[1]);
    return out;
  }

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Template name is required';
    if (!subject.trim()) errs.subject = 'Subject is required for email templates';
    if (design.blocks.length === 0) errs.design = 'Add at least one block';
    if (!design.blocks.some((b) => b.type === 'footer')) errs.design = 'A footer block with unsubscribe content is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaveState('saving');
    setSaveError('');
    const input = {
      name: name.trim(),
      channel: 'email' as const,
      subject: subject.trim(),
      body: designFallbackText(design),
      variables: detectedVars,
      editor_mode: 'visual' as const,
      design: JSON.parse(JSON.stringify(design)) as unknown,
      preheader: (preheader || design.global.preheader || '').trim() || null,
    };
    try {
      if (templateId) {
        await updateTemplate.mutateAsync({ id: templateId, input });
        setSaveState('saved');
      } else {
        const created = await createTemplate.mutateAsync(input);
        setSaveState('saved');
        if (created) onSaved?.(created.id);
      }
      setLastSavedAt(new Date().toLocaleTimeString());
      showToast('Template saved — editable structure preserved.', 'success');
    } catch (err) {
      setSaveState('error');
      setSaveError(getApiErrorMessage(err, 'Failed to save template. Your changes are still here — try again.'));
    }
  };

  const saving = saveState === 'saving';
  const previewHtml = useMemo(() => renderDesignPreview({ ...design, global: { ...design.global, preheader } }), [design, preheader]);

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <Label htmlFor="visual-name" className="text-xs">Template name *</Label>
          <Input id="visual-name" value={name} onChange={(e) => { setName(e.target.value); markDirty(); }} placeholder="e.g. Welcome — visual" className="h-9" />
          {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Editor actions">
          <span role="status" aria-live="polite" className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${saveState === 'saved' ? 'bg-emerald-50 text-emerald-700' : saveState === 'saving' ? 'bg-slate-100 text-slate-600' : saveState === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            {saveState === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : saveState === 'saved' ? <Check className="h-3 w-3" /> : null}
            {saveState === 'saved' ? `Saved${lastSavedAt ? ` · ${lastSavedAt}` : ''}` : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed — retry' : 'Unsaved changes'}
          </span>
          <Button variant="outline" size="sm" onClick={undo} disabled={past.length === 0} aria-label="Undo change"><Undo className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={redo} disabled={future.length === 0} aria-label="Redo change"><Redo className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setShowPreview(true)}><Eye className="mr-1 h-4 w-4" />Preview</Button>
          <Button variant="outline" size="sm" onClick={() => templateId ? setShowTest(true) : showToast('Save the template first, then send a test email.', 'error')}><Mail className="mr-1 h-4 w-4" />Test email</Button>
          <Button size="sm" onClick={handleSave} disabled={saving}><Save className="mr-1 h-4 w-4" />{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
      {approvalStatus && (
        <p className="text-xs text-slate-500">Approval status: <span className="font-medium">{approvalStatus}</span>{approvalStatus === 'approved' && dirty ? ' — saving content changes will reset approval to pending.' : ''}</p>
      )}
      {saveError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</p>}
      {errors.design && <p role="alert" className="text-sm text-red-600">{errors.design}</p>}

      {/* Subject + preheader */}
      <Card className="space-y-3 p-4">
        <SubjectFields subject={subject} setSubject={(v) => { setSubject(v); markDirty(); }} preheader={preheader} setPreheader={(v) => { setPreheader(v); markDirty(); }} subjectError={errors.subject} />
        {detectedVars.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Detected variables">
            {detectedVars.map((v) => <code key={v} className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">{`{{${v}}}`}</code>)}
          </div>
        )}
      </Card>

      {/* 3-pane layout (stacks on small viewports) */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* Left: palette */}
        <Card className="order-2 p-3 lg:order-1" aria-label="Blocks and sections">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Blocks</h3>
          <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {BLOCK_DEFS.map((d) => (
              <button key={d.type} type="button" onClick={() => addBlock(d.type)} className="min-w-[140px] flex-1 rounded-md border border-slate-200 p-2 text-left hover:border-indigo-300 hover:bg-indigo-50 lg:min-w-0" title={d.hint}>
                <span className="block text-sm font-medium text-slate-800">+ {d.label}</span>
                <span className="block text-[11px] text-slate-500">{d.hint}</span>
              </button>
            ))}
          </div>
          <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Reusable sections</h3>
          <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col">
            {reusableSections().map((s) => (
              <button key={s.key} type="button" onClick={() => addSection(s.key)} className="min-w-[140px] flex-1 rounded-md border border-dashed border-indigo-300 bg-indigo-50/50 p-2 text-left hover:bg-indigo-50 lg:min-w-0">
                <span className="block text-sm font-medium text-indigo-900">+ {s.name}</span>
                <span className="block text-[11px] text-indigo-700/70">{s.description}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Center: canvas */}
        <div className="order-1 lg:order-2" aria-label="Email canvas">
          <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-100 p-3" role="listbox" aria-label="Email blocks. Use the buttons on each block to reorder, duplicate, or remove it." aria-orientation="vertical">
            {design.blocks.length === 0 && (
              <div className="rounded-md bg-white p-8 text-center text-sm text-slate-500">
                No blocks yet. Add blocks or a reusable section from the palette to start designing.
              </div>
            )}
            {design.blocks.map((block, index) => {
              const isSelected = block.id === selectedId;
              return (
                <article
                  key={block.id}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => setSelectedId(block.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(block.id); }
                    else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveBlock(index, -1); }
                    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveBlock(index, 1); }
                    else if ((e.key === 'Delete' || e.key === 'Backspace') && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') { e.preventDefault(); removeBlock(index); }
                  }}
                  aria-label={`${block.type} block ${index + 1} of ${design.blocks.length}`}
                  className={`rounded-md bg-white p-3 shadow-sm outline-none transition ${isSelected ? 'ring-2 ring-indigo-500' : 'ring-1 ring-slate-200 hover:ring-slate-300'}`}
                >
                  <div className="mb-1.5 flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{block.type} · {index + 1}/{design.blocks.length}</span>
                    <div className="flex items-center gap-0.5" role="group" aria-label={`Actions for ${block.type} block`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); moveBlock(index, -1); }} disabled={index === 0} aria-label={`Move ${block.type} block up`} title="Move up"><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); moveBlock(index, 1); }} disabled={index === design.blocks.length - 1} aria-label={`Move ${block.type} block down`} title="Move down"><ArrowDown className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); duplicateBlock(index); }} aria-label={`Duplicate ${block.type} block`} title="Duplicate"><Copy className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={(e) => { e.stopPropagation(); removeBlock(index); }} aria-label={`Remove ${block.type} block`} title={block.type === 'footer' ? 'The last footer cannot be removed' : 'Remove'}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <CanvasBlockView block={block} />
                </article>
              );
            })}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Keyboard: Tab to a block, Enter to select, Alt+↑/↓ to reorder, Delete to remove. No drag-and-drop required.</p>
        </div>

        {/* Right: settings */}
        <Card className="order-3 p-3" aria-label="Block settings">
          {selected
            ? <BlockSettings key={selected.id} block={selected} onChange={(updater) => updateBlock(selected.id, updater)} onPickImage={() => setImageTarget(selected.id)} />
            : <GlobalSettings design={design} onChange={(next) => pushDesign(next)} />}
        </Card>
      </div>

      {/* Local instant preview (client render; server preview available after save via gallery) */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPreview(false)} role="dialog" aria-modal="true" aria-label="Email preview">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Preview — {name || 'Untitled'}</h3>
                <p className="text-xs text-slate-500">Fictional samples ({SAMPLE_VALUES.first_name}, {SAMPLE_VALUES.business_name}). Approximate — email clients may differ.</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowPreview(false)} aria-label="Close preview"><X className="h-4 w-4" /></Button>
            </div>
            <div className="overflow-y-auto bg-slate-100 p-4">
              {subject && <p className="mb-2 rounded bg-white px-3 py-2 text-sm"><span className="font-medium">Subject: </span>{substituteSamples(subject)}</p>}
              <iframe sandbox="" srcDoc={previewHtml} title="Email preview (isolated)" className="h-[480px] w-full rounded border-0 bg-white" />
            </div>
          </div>
        </div>
      )}
      {templateId && showTest && <TestSendModal templateId={templateId} onClose={() => setShowTest(false)} />}
      {imageTarget && (
        <ImageLibraryPicker
          onClose={() => setImageTarget(null)}
          onSelect={(url, alt) => {
            updateBlock(imageTarget, (b) => {
              if (b.type !== 'image') return b;
              b.props.src = url;
              if (!b.props.alt) b.props.alt = alt;
              return b;
            });
            setImageTarget(null);
            showToast('Image added from media library.', 'success');
          }}
        />
      )}
    </div>
  );
}

export function SavedTemplatePreview({ templateId, templateName }: { templateId: string; templateName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Eye className="mr-1 h-4 w-4" />Server preview</Button>
      {open && <TemplatePreviewModal templateId={templateId} templateName={templateName} onClose={() => setOpen(false)} />}
    </>
  );
}

function SubjectFields({ subject, setSubject, preheader, setPreheader, subjectError }: {
  subject: string; setSubject: (v: string) => void; preheader: string; setPreheader: (v: string) => void; subjectError?: string;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const preheaderRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="visual-subject">Subject *</Label>
          <VariableButtons targetRef={subjectRef} onInsert={(v) => setSubject(v)} label="Subject" />
        </div>
        <Input id="visual-subject" ref={subjectRef} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Quick idea for {{business_name}}" />
        {subjectError && <p className="text-xs text-red-600">{subjectError}</p>}
        {subject && <p className="text-xs text-slate-500">Preview: {substituteSamples(subject)}</p>}
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="visual-preheader">Preheader</Label>
          <VariableButtons targetRef={preheaderRef} onInsert={(v) => setPreheader(v)} label="Preheader" />
        </div>
        <Input id="visual-preheader" ref={preheaderRef} value={preheader} onChange={(e) => setPreheader(e.target.value)} placeholder="Short summary shown next to the subject" maxLength={300} />
        <p className="text-xs text-slate-500">Shown beside the subject in most inboxes.</p>
      </div>
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <input id={id} type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#4338ca'} onChange={(e) => onChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-slate-200" aria-label={label} />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 font-mono text-xs" aria-label={`${label} hex value`} />
      </div>
    </div>
  );
}

function AlignField({ value, onChange }: { value: 'left' | 'center' | 'right'; onChange: (v: 'left' | 'center' | 'right') => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">Alignment</Label>
      <div className="flex gap-1" role="radiogroup" aria-label="Alignment">
        {(['left', 'center', 'right'] as const).map((a) => (
          <Button key={a} type="button" variant={value === a ? 'default' : 'outline'} size="sm" className="h-7 flex-1 text-xs capitalize" onClick={() => onChange(a)} aria-pressed={value === a}>{a}</Button>
        ))}
      </div>
    </div>
  );
}

function BlockSettings({ block, onChange, onPickImage }: {
  block: EmailBlock;
  onChange: (updater: (b: EmailBlock) => EmailBlock) => void;
  onPickImage: () => void;
}) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const set = (key: string, value: unknown) =>
    onChange((b) => {
      (b.props as Record<string, unknown>)[key] = value;
      return b;
    });

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{block.type} settings</h3>
      {block.type === 'text' && (
        <>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor={`block-${block.id}-text`} className="text-xs">Text</Label>
              <VariableButtons targetRef={textRef} onInsert={(v) => set('text', v as never)} label="Block text" />
            </div>
            <Textarea id={`block-${block.id}-text`} ref={textRef} value={block.props.text} rows={5} onChange={(e) => set('text', e.target.value as never)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LabeledInput id={`block-${block.id}-size`} label="Font size" type="number" value={block.props.fontSize} onChange={(v) => set('fontSize', Math.min(72, Math.max(8, Number(v) || 16)) as never)} />
            <ColorField id={`block-${block.id}-color`} label="Color" value={block.props.color} onChange={(v) => set('color', v as never)} />
          </div>
          <AlignField value={block.props.align} onChange={(v) => set('align', v as never)} />
          <div className="flex gap-2">
            <Button type="button" variant={block.props.bold ? 'default' : 'outline'} size="sm" className="h-7 flex-1 text-xs" onClick={() => set('bold', (!block.props.bold) as never)} aria-pressed={block.props.bold}>Bold</Button>
            <Button type="button" variant={block.props.italic ? 'default' : 'outline'} size="sm" className="h-7 flex-1 text-xs" onClick={() => set('italic', (!block.props.italic) as never)} aria-pressed={block.props.italic}>Italic</Button>
          </div>
        </>
      )}
      {block.type === 'image' && (
        <>
          <Button type="button" variant="outline" size="sm" className="w-full" onClick={onPickImage}>Choose from media library</Button>
          <LabeledInput id={`block-${block.id}-src`} label="Image URL" value={block.props.src} placeholder="https://…" onChange={(v) => set('src', v as never)} />
          <LabeledInput id={`block-${block.id}-alt`} label="Alt text (accessibility)" value={block.props.alt} placeholder="Describe the image" onChange={(v) => set('alt', v as never)} />
          <LabeledInput id={`block-${block.id}-href`} label="Link destination (optional)" value={block.props.href} placeholder="https://…" onChange={(v) => set('href', v as never)} />
          <AlignField value={block.props.align} onChange={(v) => set('align', v as never)} />
        </>
      )}
      {block.type === 'button' && (
        <>
          <LabeledInput id={`block-${block.id}-label`} label="Label" value={block.props.label} onChange={(v) => set('label', v as never)} />
          <LabeledInput id={`block-${block.id}-href`} label="Destination URL" value={block.props.href} placeholder="https://…" onChange={(v) => set('href', v as never)} />
          <div className="grid grid-cols-2 gap-2">
            <ColorField id={`block-${block.id}-bg`} label="Background" value={block.props.backgroundColor} onChange={(v) => set('backgroundColor', v as never)} />
            <ColorField id={`block-${block.id}-fg`} label="Text color" value={block.props.textColor} onChange={(v) => set('textColor', v as never)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Shape</Label>
            <div className="flex gap-1" role="radiogroup" aria-label="Button shape">
              {(['square', 'rounded', 'pill'] as const).map((s) => (
                <Button key={s} type="button" variant={block.props.shape === s ? 'default' : 'outline'} size="sm" className="h-7 flex-1 text-xs capitalize" onClick={() => set('shape', s as never)} aria-pressed={block.props.shape === s}>{s}</Button>
              ))}
            </div>
          </div>
          <AlignField value={block.props.align} onChange={(v) => set('align', v as never)} />
        </>
      )}
      {block.type === 'divider' && (
        <>
          <ColorField id={`block-${block.id}-color`} label="Color" value={block.props.color} onChange={(v) => set('color', v as never)} />
          <LabeledInput id={`block-${block.id}-thick`} label="Thickness (px)" type="number" value={block.props.thickness} onChange={(v) => set('thickness', Math.min(12, Math.max(1, Number(v) || 1)) as never)} />
          <LabeledInput id={`block-${block.id}-space`} label="Spacing (px)" type="number" value={block.props.spacing} onChange={(v) => set('spacing', Math.min(80, Math.max(0, Number(v) || 0)) as never)} />
        </>
      )}
      {block.type === 'spacer' && (
        <LabeledInput id={`block-${block.id}-h`} label="Height (px)" type="number" value={block.props.height} onChange={(v) => set('height', Math.min(200, Math.max(4, Number(v) || 24)) as never)} />
      )}
      {block.type === 'columns' && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Layout</Label>
            <div className="flex gap-1" role="radiogroup" aria-label="Column layout">
              {(['1', '2'] as const).map((c) => (
                <Button key={c} type="button" variant={block.props.columns === c ? 'default' : 'outline'} size="sm" className="h-7 flex-1 text-xs" onClick={() => set('columns', c as never)} aria-pressed={block.props.columns === c}>{c === '1' ? 'One column' : 'Two columns'}</Button>
              ))}
            </div>
          </div>
          <ColumnEditor title="Left column" cell={block.props.left} onChange={(cell) => set('left', cell as never)} />
          {block.props.columns === '2' && <ColumnEditor title="Right column" cell={block.props.right} onChange={(cell) => set('right', cell as never)} />}
        </>
      )}
      {block.type === 'header' && (
        <>
          <LabeledInput id={`block-${block.id}-title`} label="Title" value={block.props.title} onChange={(v) => set('title', v as never)} />
          <LabeledInput id={`block-${block.id}-logo`} label="Logo URL (optional)" value={block.props.logoSrc} placeholder="https://…" onChange={(v) => set('logoSrc', v as never)} />
          <div className="grid grid-cols-2 gap-2">
            <ColorField id={`block-${block.id}-bg`} label="Background" value={block.props.backgroundColor} onChange={(v) => set('backgroundColor', v as never)} />
            <ColorField id={`block-${block.id}-fg`} label="Text color" value={block.props.textColor} onChange={(v) => set('textColor', v as never)} />
          </div>
        </>
      )}
      {block.type === 'footer' && (
        <>
          <div className="space-y-1">
            <Label htmlFor={`block-${block.id}-text`} className="text-xs">Footer text (sender details)</Label>
            <Textarea id={`block-${block.id}-text`} value={block.props.text} rows={3} onChange={(e) => set('text', e.target.value as never)} />
          </div>
          <LabeledInput id={`block-${block.id}-unsub`} label="Unsubscribe link" value={block.props.unsubscribeHref} onChange={(v) => set('unsubscribeHref', v as never)} />
          <p className="text-[11px] text-slate-500">Keep <code>{'{{unsubscribe_link}}'}</code> so recipients can opt out.</p>
          <div className="grid grid-cols-2 gap-2">
            <ColorField id={`block-${block.id}-bg`} label="Background" value={block.props.backgroundColor} onChange={(v) => set('backgroundColor', v as never)} />
            <ColorField id={`block-${block.id}-fg`} label="Text color" value={block.props.textColor} onChange={(v) => set('textColor', v as never)} />
          </div>
        </>
      )}
      {block.type === 'social' && (
        <>
          <AlignField value={block.props.align} onChange={(v) => set('align', v as never)} />
          <ColorField id={`block-${block.id}-color`} label="Link color" value={block.props.color} onChange={(v) => set('color', v as never)} />
          <SocialEditor links={block.props.links} onChange={(links) => set('links', links as never)} />
        </>
      )}
    </div>
  );
}

function ColumnEditor({ title, cell, onChange }: { title: string; cell: ColumnCell; onChange: (c: ColumnCell) => void }) {
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2">
      <p className="text-xs font-medium text-slate-700">{title}</p>
      <div className="space-y-1">
        <Label className="text-xs">Text</Label>
        <Textarea value={cell.text} rows={3} onChange={(e) => onChange({ ...cell, text: e.target.value })} />
      </div>
      <LabeledInput id={`${title}-img`} label="Image URL (optional)" value={cell.imageSrc} placeholder="https://…" onChange={(v) => onChange({ ...cell, imageSrc: v })} />
      <LabeledInput id={`${title}-btn`} label="Button label (optional)" value={cell.buttonLabel} onChange={(v) => onChange({ ...cell, buttonLabel: v })} />
      <LabeledInput id={`${title}-href`} label="Button link" value={cell.buttonHref} placeholder="https://…" onChange={(v) => onChange({ ...cell, buttonHref: v })} />
    </div>
  );
}

const SOCIAL_NETWORKS = ['website', 'linkedin', 'facebook', 'instagram', 'youtube', 'x'];

function SocialEditor({ links, onChange }: { links: Array<{ network: string; href: string }>; onChange: (l: Array<{ network: string; href: string }>) => void }) {
  return (
    <div className="space-y-2">
      {links.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <select value={l.network} onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, network: e.target.value } : x)))} className="h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label={`Social link ${i + 1} network`}>
            {SOCIAL_NETWORKS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <Input value={l.href} placeholder="https://…" onChange={(e) => onChange(links.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))} className="h-8 text-xs" aria-label={`Social link ${i + 1} URL`} />
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onChange(links.filter((_, j) => j !== i))} aria-label={`Remove social link ${i + 1}`}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      {links.length < 6 && (
        <Button type="button" variant="outline" size="sm" className="h-7 w-full text-xs" onClick={() => onChange([...links, { network: 'website', href: '' }])}>+ Add link</Button>
      )}
    </div>
  );
}

function GlobalSettings({ design, onChange }: { design: EmailDesign; onChange: (d: EmailDesign) => void }) {
  const setGlobal = (patch: Partial<EmailDesign['global']>) =>
    onChange({ ...design, global: { ...design.global, ...patch } });
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Email settings</h3>
      <p className="text-[11px] text-slate-500">Select a block to edit it, or adjust the whole email here.</p>
      <ColorField id="global-bg" label="Email background" value={design.global.backgroundColor} onChange={(v) => setGlobal({ backgroundColor: v })} />
      <ColorField id="global-brand" label="Brand color (buttons, links)" value={design.global.brandColor} onChange={(v) => setGlobal({ brandColor: v })} />
      <LabeledInput id="global-width" label="Content width (px, 320–900)" type="number" value={design.global.contentWidth} onChange={(v) => setGlobal({ contentWidth: Math.min(900, Math.max(320, Number(v) || 600)) })} />
      <div className="space-y-1">
        <Label htmlFor="global-font" className="text-xs">Font (email-safe)</Label>
        <select id="global-font" value={design.global.fontFamily} onChange={(e) => setGlobal({ fontFamily: e.target.value })} className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm">
          <option value="Arial, Helvetica, sans-serif">Arial / Helvetica</option>
          <option value="Georgia, 'Times New Roman', serif">Georgia / Serif</option>
          <option value="'Helvetica Neue', Helvetica, Arial, sans-serif">Helvetica Neue</option>
          <option value="Verdana, Geneva, sans-serif">Verdana</option>
          <option value="'Trebuchet MS', Verdana, sans-serif">Trebuchet</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="global-preheader" className="text-xs">Preheader</Label>
        <Input id="global-preheader" value={design.global.preheader} maxLength={300} onChange={(e) => setGlobal({ preheader: e.target.value })} className="h-8 text-sm" />
      </div>
    </div>
  );
}
