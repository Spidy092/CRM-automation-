import { createPipeline } from './src/modules/pipeline/pipeline.service';
import { pool } from './src/shared/utils/db';

async function run() {
  try {
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    if (userRes.rows.length === 0) {
      console.log("No users found");
      return;
    }
    const userId = userRes.rows[0].id;

    console.log("Using user ID:", userId);
    
    const p = await createPipeline(
      {
        name: 'Test Pipeline ' + Date.now(),
        is_default: false,
        stages: [
          { name: 'New Lead', position: 0, is_terminal_won: false, is_terminal_lost: false },
          { name: 'Contacted', position: 1, is_terminal_won: false, is_terminal_lost: false },
          { name: 'Qualified', position: 2, is_terminal_won: false, is_terminal_lost: false },
          { name: 'Proposal', position: 3, is_terminal_won: false, is_terminal_lost: false },
          { name: 'Won', position: 4, is_terminal_won: true, is_terminal_lost: false }
        ]
      },
      { id: userId, role: 'admin' }
    );
    console.log("Success:", p.id);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await pool.end();
  }
}
run();
