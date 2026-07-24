import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, Check, Wand2, X } from 'lucide-react';
import type { PageBlock } from '@/api/pages';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApply: (generated: { title: string; description: string; blocks: PageBlock[] }) => void;
}

const TEMPLATES = [
  {
    industry: 'B2B SaaS / Tech',
    tone: 'Professional & Direct',
    title: 'Enterprise CRM & Sales Automation Platform',
    description: 'Scale your outbound campaigns, automate lead assignments, and capture 3x more qualified pipeline with AI.',
    ctaLabel: 'Book a Free Demo',
    ctaUrl: 'https://calendly.com',
  },
  {
    industry: 'Real Estate & Properties',
    tone: 'Persuasive & High Touch',
    title: 'Exclusive Luxury Commercial & Residential Listings',
    description: 'Explore premier properties with high ROI potential. Request private virtual walkthroughs & investor brochures.',
    ctaLabel: 'Schedule Private Viewing',
    ctaUrl: 'https://calendly.com',
  },
  {
    industry: 'Consulting & Agencies',
    tone: 'Authoritative & Results Driven',
    title: 'Growth Advisory & Revenue Engineering for High Growth Brands',
    description: 'We audit your customer funnel, optimize unit economics, and unlock predictable month-over-month expansion.',
    ctaLabel: 'Get Free Funnel Audit',
    ctaUrl: 'https://calendly.com',
  },
  {
    industry: 'E-Commerce & Retail',
    tone: 'Urgent & Enthusiastic',
    title: 'Limited Time Product Showcase & Exclusive Bundle Offer',
    description: 'Discover top-tier products back in stock today. Enjoy zero shipping fees and 30-day money-back guarantee.',
    ctaLabel: 'Claim Exclusive Offer',
    ctaUrl: 'https://store.example.com',
  },
];

export function AICopyModal({ isOpen, onClose, onApply }: Props) {
  const [productTopic, setProductTopic] = useState('');
  const [selectedIndustry, setSelectedIndustry] = useState('B2B SaaS / Tech');
  const [tone, setTone] = useState('Professional & Direct');
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<{
    title: string;
    description: string;
    blocks: PageBlock[];
  } | null>(null);

  if (!isOpen) return null;

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      const match = TEMPLATES.find((t) => t.industry === selectedIndustry) || TEMPLATES[0];
      const customTitle = productTopic.trim()
        ? `${productTopic.trim()} — ${match.industry}`
        : match.title;
      const customDesc = productTopic.trim()
        ? `Accelerate your revenue with ${productTopic.trim()}. ${match.description}`
        : match.description;

      const generatedBlocks: PageBlock[] = [
        {
          type: 'link',
          label: match.ctaLabel,
          url: match.ctaUrl,
        },
      ];

      setResult({
        title: customTitle,
        description: customDesc,
        blocks: generatedBlocks,
      });
      setIsGenerating(false);
    }, 600);
  };

  const handleApply = () => {
    if (result) {
      onApply(result);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">AI Landing Copy Generator</h3>
              <p className="text-xs text-slate-500">Generate high-converting headlines, copy, & CTA buttons.</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="topic">Product / Service Keyword (optional)</Label>
            <Input
              id="topic"
              placeholder="e.g. Healthcare Analytics, Auto Financing, Cloud Migration"
              value={productTopic}
              onChange={(e) => setProductTopic(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Industry Persona</Label>
              <select
                value={selectedIndustry}
                onChange={(e) => setSelectedIndustry(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs"
              >
                {TEMPLATES.map((t) => (
                  <option key={t.industry} value={t.industry}>
                    {t.industry}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Brand Tone</Label>
              <select
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-xs"
              >
                <option value="Professional & Direct">Professional & Direct</option>
                <option value="Persuasive & High Touch">Persuasive & High Touch</option>
                <option value="Authoritative & Results Driven">Authoritative & Results</option>
                <option value="Urgent & Enthusiastic">Urgent & Enthusiastic</option>
              </select>
            </div>
          </div>

          <Button
            type="button"
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            onClick={handleGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Wand2 className="mr-2 h-4 w-4 animate-spin" />
                Generating AI Copy…
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                Generate Page Copy
              </>
            )}
          </Button>

          {result && (
            <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/50 p-4">
              <div>
                <span className="text-[10px] font-semibold tracking-wider text-indigo-600 uppercase">Suggested Title</span>
                <p className="text-sm font-semibold text-slate-900">{result.title}</p>
              </div>

              <div>
                <span className="text-[10px] font-semibold tracking-wider text-indigo-600 uppercase">Suggested Description</span>
                <p className="text-xs text-slate-700">{result.description}</p>
              </div>

              <div className="pt-2">
                <Button type="button" size="sm" className="w-full" onClick={handleApply}>
                  <Check className="mr-2 h-4 w-4" />
                  Apply Copy to Editor
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
