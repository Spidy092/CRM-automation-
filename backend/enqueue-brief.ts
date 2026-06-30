import { enqueueAiCampaignBrief } from './src/workers/queue';

async function run() {
  const campaignId = 'd4dca631-4442-452d-b438-895fa52acba7'; // ID from their error log
  await enqueueAiCampaignBrief({ campaignId, triggeredBy: '00000000-0000-0000-0000-000000000000' });
  console.log('Enqueued!');
  process.exit(0);
}
run();
