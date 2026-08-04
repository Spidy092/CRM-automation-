import { useState } from 'react';
import { useCreateSequence, type Sequence } from '@/api/outreach';
import { useCreateTemplate } from '@/api/templates';
import { extractVariables } from '@/lib/templateVars';
import type { SequencePreset } from '@/lib/sequencePresets';

/**
 * Turns a {@link SequencePreset} into real records: one template per step, then the
 * sequence that references them. Templates land approved for roles that could approve
 * them anyway, so the resulting sequence is immediately usable by a campaign.
 *
 * Templates are created sequentially rather than in parallel so a partial failure
 * leaves an obvious, ordered trail instead of a scattered set of orphans.
 */
export function useSequencePreset() {
  const createTemplate = useCreateTemplate();
  const createSequence = useCreateSequence();
  const [isApplying, setIsApplying] = useState(false);

  const applyPreset = async (preset: SequencePreset): Promise<Sequence> => {
    setIsApplying(true);
    try {
      const steps = [];
      for (const [index, step] of preset.steps.entries()) {
        const template = await createTemplate.mutateAsync({
          name: `${preset.name} · ${step.template.name}`,
          channel: step.channel,
          subject: step.template.subject,
          body: step.template.body,
          variables: extractVariables(step.template.body),
        });
        steps.push({
          stepNumber: index + 1,
          channel: step.channel,
          delayHours: step.delayHours,
          templateId: template.id,
        });
      }

      return await createSequence.mutateAsync({
        name: preset.name,
        description: preset.description,
        steps,
      });
    } finally {
      setIsApplying(false);
    }
  };

  return { applyPreset, isApplying };
}
