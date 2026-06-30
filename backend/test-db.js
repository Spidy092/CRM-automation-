const { Client } = require('pg');
const client = new Client('postgres://postgres:postgres@localhost:5432/crm_test');
async function run() {
  await client.connect().catch(e => console.log("error connecting to crm_test:", e.message));
  const client2 = new Client('postgres://postgres:postgres@localhost:5432/crm');
  await client2.connect().catch(e => console.log("error connecting to crm:", e.message));
}
run();
