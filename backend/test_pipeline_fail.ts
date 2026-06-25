import { createPipeline } from './src/modules/pipeline/pipeline.service';
import { pool } from './src/shared/utils/db';

async function run() {
  try {
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    const userId = userRes.rows[0].id;
    
    const p = await createPipeline(
      {
        name: 'Test Pipeline Double Won',
        is_default: false,
        stages: [
          { name: 'S1', position: 1, is_terminal_won: true, is_terminal_lost: false },
          { name: 'S2', position: 2, is_terminal_won: true, is_terminal_lost: false }
        ]
      },
      { id: userId, role: 'admin' }
    );
    console.log("Success:", p.id);
  } catch (err) {
    console.error("Error expected:", err.message);
  } finally {
    await pool.end();
  }
}
run();
