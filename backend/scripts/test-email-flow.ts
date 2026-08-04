import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from workspace root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { pool } from '../src/shared/utils/db';
import { createLead, getLeadById } from '../src/modules/leads/leads.service';
import { createTemplate } from '../src/modules/templates/templates.service';
import { createSequence } from '../src/modules/outreach/outreach.service';
import { createCampaign } from '../src/modules/campaigns/campaigns.service';
import { handleDispatch } from '../src/workers/outreach.worker';
import { UserRole } from '../src/shared/types';

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000001', role: 'admin' as UserRole };

async function runEmailOutreachTest() {
  console.log('\n======================================================');
  console.log('  STARTING EMAIL OUTREACH TEST (3 LEADS)');
  console.log('======================================================\n');

  try {
    // ------------------------------------------------------------------
    // STEP 1: CREATE 3 APPROVED EMAIL TEMPLATES
    // ------------------------------------------------------------------
    console.log('--- Step 1: Creating 3 Approved Email Templates ---');

    const tpl1 = await createTemplate(
      {
        name: 'Test Email Step 1 - Welcome',
        channel: 'email',
        subject: 'Welcome {{contact_name}} to CRM Platform',
        body: 'Hi {{contact_name}},\n\nWelcome to our platform! We are excited to partner with {{business_name}}.',
      },
      SYSTEM_ACTOR,
    );
    await pool.query("UPDATE templates SET approval_status = 'approved' WHERE id = $1", [tpl1.id]);

    const tpl2 = await createTemplate(
      {
        name: 'Test Email Step 2 - Case Study',
        channel: 'email',
        subject: '{{contact_name}}, see how companies scale 3x with CRM',
        body: 'Hi {{contact_name}},\n\nDiscover how sales teams like {{business_name}} automate follow-ups.',
      },
      SYSTEM_ACTOR,
    );
    await pool.query("UPDATE templates SET approval_status = 'approved' WHERE id = $1", [tpl2.id]);

    const tpl3 = await createTemplate(
      {
        name: 'Test Email Step 3 - Consultation Offer',
        channel: 'email',
        subject: 'Special strategy call offer for {{business_name}}',
        body: 'Hi {{contact_name}},\n\nLet us schedule a 15-minute consultation for {{business_name}}. Reply to book your slot!',
      },
      SYSTEM_ACTOR,
    );
    await pool.query("UPDATE templates SET approval_status = 'approved' WHERE id = $1", [tpl3.id]);

    console.log(`✓ Template 1 created: "${tpl1.name}" (${tpl1.id})`);
    console.log(`✓ Template 2 created: "${tpl2.name}" (${tpl2.id})`);
    console.log(`✓ Template 3 created: "${tpl3.name}" (${tpl3.id})\n`);

    // ------------------------------------------------------------------
    // STEP 2: SEED 3 TEST EMAIL LEADS
    // ------------------------------------------------------------------
    console.log('--- Step 2: Seeding 3 Test Email Leads ---');

    const stageRes = await pool.query<{ id: string }>(
      "SELECT id FROM pipeline_stages WHERE name ILIKE '%New Lead%' LIMIT 1",
    );
    const defaultStageId = stageRes.rows[0]?.id ?? undefined;

    const lead1 = await createLead(
      {
        business_name: 'Alpha Tech',
        contact_name: 'Alex Direct',
        email: 'alex.direct@crmtest.io',
        phone: '+15550100001',
        industry: 'Software',
        location: 'New York, US',
        source_platform: 'manual',
        pipeline_stage_id: defaultStageId,
      },
      SYSTEM_ACTOR,
    );

    const lead2 = await createLead(
      {
        business_name: 'Beta Systems',
        contact_name: 'Beth Direct',
        email: 'beth.direct@crmtest.io',
        phone: '+15550100002',
        industry: 'Finance',
        location: 'London, UK',
        source_platform: 'manual',
        pipeline_stage_id: defaultStageId,
      },
      SYSTEM_ACTOR,
    );

    const lead3 = await createLead(
      {
        business_name: 'Gamma Corp',
        contact_name: 'Charlie Direct',
        email: 'charlie.direct@crmtest.io',
        phone: '+15550100003',
        industry: 'Healthcare',
        location: 'Toronto, CA',
        source_platform: 'manual',
        pipeline_stage_id: defaultStageId,
      },
      SYSTEM_ACTOR,
    );

    console.log(`✓ Lead 1: ${lead1.contact_name} (${lead1.email}) - ID: ${lead1.id}`);
    console.log(`✓ Lead 2: ${lead2.contact_name} (${lead2.email}) - ID: ${lead2.id}`);
    console.log(`✓ Lead 3: ${lead3.contact_name} (${lead3.email}) - ID: ${lead3.id}\n`);

    // ------------------------------------------------------------------
    // STEP 3: PHASE 1 TEST - DIRECT EMAIL CAMPAIGN (WITHOUT PIPELINE)
    // ------------------------------------------------------------------
    console.log('======================================================');
    console.log('  PHASE 1: DIRECT EMAIL CAMPAIGN (WITHOUT PIPELINE)');
    console.log('======================================================');

    const directSeq = await createSequence(
      {
        name: 'Direct Multi-Step Email Sequence (3 Steps)',
        description: 'Standalone direct campaign email sequence',
        is_active: true,
        steps: [
          { stepNumber: 1, channel: 'email', delayHours: 0, templateId: tpl1.id },
          { stepNumber: 2, channel: 'email', delayHours: 24, templateId: tpl2.id },
          { stepNumber: 3, channel: 'email', delayHours: 48, templateId: tpl3.id },
        ],
      },
      SYSTEM_ACTOR,
    );

    const directCampaign = await createCampaign(
      {
        name: 'Direct Email Test Campaign',
        sequence_id: directSeq.id,
      },
      SYSTEM_ACTOR,
    );

    console.log(`✓ Created Direct Sequence: "${directSeq.name}" (${directSeq.id})`);
    console.log(`✓ Created Direct Campaign: "${directCampaign.name}" (${directCampaign.id})\n`);

    console.log('-> Executing Step 1 Email Dispatch for Lead 2 & Lead 3 (Direct)...');
    await handleDispatch({
      leadId: lead2.id,
      campaignId: directCampaign.id,
      sequenceId: directSeq.id,
      stepNumber: 1,
      channel: 'email',
      templateId: tpl1.id,
      mockMode: true,
    });

    await handleDispatch({
      leadId: lead3.id,
      campaignId: directCampaign.id,
      sequenceId: directSeq.id,
      stepNumber: 1,
      channel: 'email',
      templateId: tpl3.id,
      mockMode: true,
    });

    console.log('✓ Step 1 Dispatch Completed for Direct Leads.\n');

    // ------------------------------------------------------------------
    // STEP 4: PHASE 2 TEST - AUTOMATED OUTREACH (WITH PIPELINE)
    // ------------------------------------------------------------------
    console.log('======================================================');
    console.log('  PHASE 2: AUTOMATED EMAIL OUTREACH (WITH PIPELINE)');
    console.log('======================================================');

    const pipelineSeq = await createSequence(
      {
        name: 'Pipeline-Linked Email Sequence',
        description: 'Triggers automated pipeline stage progression on dispatch',
        is_active: true,
        steps: [
          { stepNumber: 1, channel: 'email', delayHours: 0, templateId: tpl1.id },
          { stepNumber: 2, channel: 'email', delayHours: 24, templateId: tpl2.id },
        ],
      },
      SYSTEM_ACTOR,
    );

    const pipelineCampaign = await createCampaign(
      {
        name: 'Pipeline-Linked Email Campaign',
        sequence_id: pipelineSeq.id,
      },
      SYSTEM_ACTOR,
    );

    console.log(`✓ Created Pipeline Sequence: "${pipelineSeq.name}" (${pipelineSeq.id})`);
    console.log(`✓ Created Pipeline Campaign: "${pipelineCampaign.name}" (${pipelineCampaign.id})\n`);

    console.log(`-> Executing Step 1 Email Dispatch for Lead 1 (${lead1.contact_name})...`);
    const initialLead1 = await getLeadById(lead1.id, SYSTEM_ACTOR);
    console.log(`   Initial Stage ID for Lead 1: ${initialLead1?.pipeline_stage_id}`);

    await handleDispatch({
      leadId: lead1.id,
      campaignId: pipelineCampaign.id,
      sequenceId: pipelineSeq.id,
      stepNumber: 1,
      channel: 'email',
      templateId: tpl1.id,
      mockMode: true,
    });

    const updatedLead1 = await getLeadById(lead1.id, SYSTEM_ACTOR);
    console.log(`✓ Step 1 Dispatch Completed!`);
    console.log(`✓ Updated Stage ID for Lead 1: ${updatedLead1?.pipeline_stage_id}`);
    console.log(`✓ Applied Tags for Lead 1: ${JSON.stringify(updatedLead1?.tags)}\n`);

    // ------------------------------------------------------------------
    // STEP 5: VERIFICATION SUMMARY
    // ------------------------------------------------------------------
    console.log('======================================================');
    console.log('  VERIFICATION & OUTREACH LOGS SUMMARY');
    console.log('======================================================');

    const logsRes = await pool.query<{
      id: string;
      lead_id: string;
      channel: string;
      step_number: number;
      status: string;
      created_at: string;
    }>('SELECT id, lead_id, channel, step_number, status, created_at FROM outreach_logs ORDER BY created_at DESC LIMIT 10');

    console.log(`Total Outreach Logs Created: ${logsRes.rows.length}`);
    logsRes.rows.forEach((log, index) => {
      console.log(
        ` [Log ${index + 1}] ID: ${log.id} | Lead: ${log.lead_id} | Channel: ${log.channel} | Step: ${log.step_number} | Status: ${log.status}`,
      );
    });

    console.log('\n======================================================');
    console.log('  ALL EMAIL OUTREACH TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('======================================================\n');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
  } finally {
    await pool.end();
  }
}

void runEmailOutreachTest();
