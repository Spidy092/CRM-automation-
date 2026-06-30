import { pool } from './src/shared/utils/db';
import { calculateLeadScore } from './src/modules/scoring/scoring.service';

async function run() {
  const leadRes = await pool.query("SELECT id, business_name FROM leads WHERE business_name = 'Ooru Canteen' LIMIT 1");
  if (leadRes.rows.length === 0) {
    console.log('Lead not found');
    process.exit(1);
  }
  const id = leadRes.rows[0].id;
  const res = await calculateLeadScore(id);
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
run();
