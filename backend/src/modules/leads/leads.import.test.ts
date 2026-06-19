import * as XLSX from 'xlsx';

jest.mock('./leads.repository', () => ({
  findExistingForDedup: jest.fn(),
  insertLead: jest.fn(),
  updateLead: jest.fn(),
  findLeadById: jest.fn(),
  findLeads: jest.fn(),
  softDeleteLead: jest.fn(),
  updateLeadStatus: jest.fn(),
}));
jest.mock('../custom-fields/customFields.repository', () => ({
  findActiveDefinitions: jest.fn(),
}));
jest.mock('../custom-fields/customFields.service', () => ({
  validateCustomFieldValues: jest.fn(),
}));
jest.mock('../../shared/utils/audit', () => ({ writeAuditLog: jest.fn() }));

import { importLeads, isSupportedFile, parseFile } from './leads.import';
import { findExistingForDedup, insertLead, updateLead } from './leads.repository';
import { validateCustomFieldValues } from '../custom-fields/customFields.service';
import { findActiveDefinitions } from '../custom-fields/customFields.repository';

beforeEach(() => {
  jest.clearAllMocks();
  (findActiveDefinitions as jest.Mock).mockResolvedValue([]);
  (validateCustomFieldValues as jest.Mock).mockReturnValue({
    valid: true,
    sanitized: {},
    errors: [],
  });
});

describe('isSupportedFile', () => {
  it('accepts csv, xlsx, xls (case-insensitive)', () => {
    expect(isSupportedFile('leads.csv')).toBe(true);
    expect(isSupportedFile('leads.XLSX')).toBe(true);
    expect(isSupportedFile('leads.XLS')).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(isSupportedFile('leads.txt')).toBe(false);
    expect(isSupportedFile('leads')).toBe(false);
    expect(isSupportedFile('leads.pdf')).toBe(false);
  });
});

describe('parseFile', () => {
  it('parses a CSV buffer into row objects', () => {
    const csv =
      'business_name,contact_name,phone,email,industry,location,source_platform\n' +
      'Acme,John,+1234567890,john@acme.com,Tech,NYC,manual_upload\n';
    const rows = parseFile(Buffer.from(csv), 'leads.csv');
    expect(rows).toHaveLength(1);
    expect(rows[0].business_name).toBe('Acme');
  });

  it('parses an XLSX buffer into row objects', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [
        'business_name',
        'contact_name',
        'phone',
        'email',
        'industry',
        'location',
        'source_platform',
      ],
      ['Beta', 'Jane', '+1987654321', 'jane@beta.com', 'Tech', 'LA', 'manual_upload'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const rows = parseFile(buf, 'leads.xlsx');
    expect(rows).toHaveLength(1);
    expect(rows[0].business_name).toBe('Beta');
  });

  it('throws on unsupported file type', () => {
    expect(() => parseFile(Buffer.from('x'), 'leads.txt')).toThrow('Unsupported file type');
  });
});

describe('importLeads', () => {
  it('creates new leads, updates existing ones, and collects failures', async () => {
    const csv =
      'business_name,contact_name,phone,email,industry,location,source_platform\n' +
      'Acme,John,+1234567890,john@acme.com,Tech,NYC,manual_upload\n' +
      'Beta,Jane,+1987654321,jane@beta.com,Tech,LA,manual_upload\n' +
      'Bad,Bob,123,bad-email,Tech,SF,manual_upload\n';

    (findExistingForDedup as jest.Mock)
      .mockResolvedValueOnce(null) // row 1 -> new
      .mockResolvedValueOnce({ id: 'existing-1' }); // row 2 -> existing
    (insertLead as jest.Mock).mockResolvedValue({ id: 'new-1' });
    (updateLead as jest.Mock).mockResolvedValue({ id: 'existing-1' });

    const summary = await importLeads(Buffer.from(csv), 'leads.csv', 'manual_upload', {
      id: 'admin-1',
    });

    expect(summary.total).toBe(3);
    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(insertLead).toHaveBeenCalledTimes(1);
    expect(updateLead).toHaveBeenCalledTimes(1);
  });

  it('fails a row whose custom fields are invalid', async () => {
    const csv =
      'business_name,contact_name,phone,email,industry,location,source_platform\n' +
      'Acme,John,+1234567890,john@acme.com,Tech,NYC,manual_upload\n';
    (validateCustomFieldValues as jest.Mock).mockReturnValue({
      valid: false,
      sanitized: {},
      errors: ['bad field'],
    });

    const summary = await importLeads(Buffer.from(csv), 'leads.csv', 'manual_upload', {
      id: 'admin-1',
    });

    expect(summary.failed).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.errors[0].message).toContain('bad field');
  });
});
