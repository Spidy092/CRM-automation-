import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

function importedModules(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  return source.statements.flatMap((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      return [statement.moduleSpecifier.text];
    }
    return [];
  });
}

describe('ownership module import boundary', () => {
  const leadsService = join(__dirname, '../leads/leads.service.ts');
  const assignmentsService = join(__dirname, 'assignments.service.ts');

  it('keeps the dependency one-way from assignments to leads', () => {
    expect(importedModules(leadsService)).not.toContain('../assignments/assignments.service');
    expect(importedModules(assignmentsService)).toContain('../leads/leads.service');
  });
});
