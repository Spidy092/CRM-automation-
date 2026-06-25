import { pool } from './src/shared/utils/db';
async function run() {
  const res = await pool.query('SELECT pipeline_id, name, is_terminal_won, is_terminal_lost FROM pipeline_stages;');
  console.log(res.rows);
  process.exit(0);
}
run();
