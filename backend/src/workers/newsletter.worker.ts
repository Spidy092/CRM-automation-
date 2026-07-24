import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import OpenAI from 'openai';
import { NEWSLETTER_QUEUE, getBullConnection, type NewsletterBroadcastJob, enqueueNewsletterBroadcast } from './queue';
import { logger } from '../shared/utils/logger';
import { getAiConfig } from '../modules/ai-settings/ai-settings.service';
import { getDigestConfig } from '../modules/newsletter/newsletter.service';
import { findSubscribers } from '../modules/newsletter/newsletter.repository';
import * as sendgrid from '../modules/integrations/sendgrid/sendgrid.connector';
import * as smtp from '../modules/integrations/smtp/smtp.connector';

async function processBroadcast(job: Job<NewsletterBroadcastJob>): Promise<void> {
  const { subject, htmlBody } = job.data;
  let offset = 0;
  const limit = 100;
  let processed = 0;
  
  const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

  while (true) {
    const subscribers = await findSubscribers(limit, offset, 'confirmed');
    if (subscribers.length === 0) break;

    for (const sub of subscribers) {
      const prefsUrl = `${baseUrl}/newsletter/preferences?token=${sub.unsubscribe_token_hash}`;
      const unsubUrl = `${baseUrl}/newsletter/unsubscribe?token=${sub.unsubscribe_token_hash}`;
      
      const personalizedBody = `${htmlBody}
        <br/><br/>
        <hr/>
        <p style="font-size: 12px; color: #666;">
          You are receiving this because you subscribed to our newsletter.<br/>
          <a href="${prefsUrl}">Update Preferences</a> | <a href="${unsubUrl}">Unsubscribe</a>
        </p>
      `;

      const emailInput = { leadId: sub.id,
        to: sub.email,
        subject,
        htmlBody: personalizedBody,
      };

      try {
        const sgRes = await sendgrid.sendEmail(emailInput);
        if (!sgRes.ok) throw new Error('SendGrid returned not ok');
      } catch (sgErr) {
        try {
          await smtp.sendEmail(emailInput);
        } catch (smtpErr) {
          logger.error('Failed to send newsletter email to subscriber', { email: sub.email });
        }
      }
      processed++;
    }
    
    offset += limit;
  }
  
  logger.info('Newsletter broadcast complete', { jobId: job.id, totalProcessed: processed });
}

async function processAutomatedDigest(job: Job): Promise<void> {
  logger.info('Starting automated newsletter digest generation', { jobId: job.id });
  
  let aiConfig;
  try {
    aiConfig = await getAiConfig();
  } catch (err) {
    logger.warn('Failed to fetch AI settings for digest', { error: (err as Error).message });
  }

  let digestConfig;
  try {
    const configRes = await getDigestConfig();
    digestConfig = configRes.ok ? configRes.value : undefined;
  } catch (err) {
    logger.warn('Failed to fetch newsletter digest config', { error: (err as Error).message });
  }

  const apiKey = aiConfig?.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('OPENAI_API_KEY missing; cannot generate automated digest');
    return;
  }

  const client = new OpenAI({
    apiKey,
    baseURL: aiConfig?.baseUrl || undefined,
  });

  const topic = digestConfig?.topic || 'Weekly Sales Tips & Growth Hacks';
  const tone = digestConfig?.tone || 'professional';
  const targetAudience = digestConfig?.targetAudience || 'Sales reps and business professionals';
  const customPrompt = digestConfig?.customPrompt || 'Provide actionable sales techniques and productivity advice.';

  const system =
    aiConfig?.systemPromptOverride ||
    `You are an expert CRM assistant drafting a weekly newsletter digest. Tone: ${tone}. Target Audience: ${targetAudience}. Keep it under 200 words, highly engaging, and beautifully structured.`;

  const user = `Topic: ${topic}.\nGuidelines: ${customPrompt}\nWrite an engaging newsletter tip/digest post for our subscribers. Do not include markdown headers (# or ##), write clear HTML paragraphs and bullet points.`;

  try {
    const completion = await client.chat.completions.create({
      model: aiConfig?.model || 'gpt-4o',
      max_tokens: Math.min(aiConfig?.maxTokens || 500, 500),
      temperature: aiConfig?.temperature || 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? '';
    
    // Fallback if empty
    if (!content) throw new Error('AI returned empty content');

    // Enqueue the broadcast job with the generated content
    const subject = `${topic} - ${new Date().toLocaleDateString()}`;
    const htmlBody = `<div style="font-family: sans-serif; line-height: 1.5; color: #333;">${content.replace(/\n\n/g, '<br/><br/>')}</div>`;
    
    await enqueueNewsletterBroadcast({ subject, htmlBody });
    
    logger.info('Automated newsletter digest generated and broadcast enqueued successfully');
  } catch (err) {
    logger.error('Failed to generate automated digest', { error: (err as Error).message });
  }
}

export function startNewsletterWorker(): Worker {
  const worker = new Worker(
    NEWSLETTER_QUEUE,
    async (job: Job) => {
      logger.info(`Processing ${NEWSLETTER_QUEUE} job`, { jobName: job.name, jobId: job.id });
      
      if (job.name === 'newsletter:broadcast') {
        await processBroadcast(job as Job<NewsletterBroadcastJob>);
      } else if (job.name === 'newsletter:automated-digest') {
        await processAutomatedDigest(job);
      } else {
        logger.warn(`Unknown job name in ${NEWSLETTER_QUEUE}`, { jobName: job.name });
      }
    },
    { connection: getBullConnection() as unknown as ConnectionOptions }
  );

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} in ${NEWSLETTER_QUEUE} failed`, {
      jobName: job?.name,
      error: err.message,
    });
  });

  return worker;
}
