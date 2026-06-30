import { query } from './src/shared/utils/db';

async function run() {
  await query('UPDATE campaigns SET sequence_id = $1 WHERE id = $2', [
    '031bb94b-2aa6-4a9e-a99f-568ef959da48',
    'd4dca631-4442-452d-b438-895fa52acba7',
  ]);
  console.log('Sequence connected successfully!');
  
  const integrations = await query('SELECT name, is_enabled FROM integrations WHERE name = $1', ['openwa']);
  console.log('OpenWA Integration:', integrations);
  process.exit(0);
}

run().catch(console.error);
