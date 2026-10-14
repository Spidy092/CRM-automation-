import fs from 'fs';
import path from 'path';

describe('database migration ordering', () => {
  it('keeps new migrations unique and opts around the known production history conflict', () => {
    const migrationsDirectory = path.resolve(__dirname, '../../../../migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.js'));
    const prefixes = migrationFiles.map((file) => file.match(/^(\d+)_/)?.[1]);
    const newMigrationPrefixes = prefixes.filter(
      (prefix): prefix is string => prefix !== undefined && prefix > '1750000000075',
    );
    const deployWorkflowPath = path.resolve(
      __dirname,
      '../../../../.github/workflows/deploy-ssh.yml',
    );
    const deployWorkflow = fs.readFileSync(deployWorkflowPath, 'utf8');

    expect(prefixes.every((prefix): prefix is string => prefix !== undefined)).toBe(true);
    expect(new Set(newMigrationPrefixes).size).toBe(newMigrationPrefixes.length);
    expect(deployWorkflow).toContain('node-pg-migrate up --no-check-order -m /migrations');
  });
});
