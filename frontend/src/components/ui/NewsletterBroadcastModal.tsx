import React, { useState } from 'react';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';
import { useBroadcast } from '@/api/newsletter';
import { useToast } from '@/components/ui/Toast';

interface Props {
  onClose: () => void;
}

export function NewsletterBroadcastModal({ onClose }: Props) {
  const [subject, setSubject] = useState('');
  const [htmlBody, setHtmlBody] = useState('');
  const broadcastMutation = useBroadcast();
  const { showToast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !htmlBody.trim()) {
      showToast('Please provide a subject and HTML body.', 'error');
      return;
    }
    try {
      await broadcastMutation.mutateAsync({ subject, htmlBody });
      showToast('Broadcast enqueued successfully!');
      onClose();
    } catch (err) {
      showToast('Failed to enqueue broadcast.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-xl font-bold">New Broadcast</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Exciting Product Updates!"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">HTML Body</label>
            <Textarea
              value={htmlBody}
              onChange={(e) => setHtmlBody(e.target.value)}
              placeholder="<h1>Hello World</h1><p>Our newsletter content...</p>"
              rows={8}
              required
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={broadcastMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={broadcastMutation.isPending}>
              {broadcastMutation.isPending ? 'Sending...' : 'Send Broadcast'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
