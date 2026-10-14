import { captureWebsiteLead } from './websiteCapture.service';
import { findExistingForDedup, insertLead } from './leads.repository';
import { withAdvisoryLocks } from '../../shared/utils/db';

jest.mock('./leads.repository', () => ({ findExistingForDedup: jest.fn(), insertLead: jest.fn() }));
jest.mock('../../shared/utils/db', () => ({ withAdvisoryLocks: jest.fn() }));
const input = {
  business_name: 'Example',
  contact_name: 'Visitor',
  email: 'person@example.com',
  phone: '',
  industry: 'Unknown',
  location: 'Unknown',
  source_platform: 'website_form',
};
beforeEach(() => {
  jest.resetAllMocks();
  (withAdvisoryLocks as jest.Mock).mockImplementation(async (_keys, fn) => fn());
  (findExistingForDedup as jest.Mock).mockResolvedValue(null);
  (insertLead as jest.Mock).mockResolvedValue({ id: 'lead-1' });
});
it('reuses a matching lead without overwriting it', async () => {
  (findExistingForDedup as jest.Mock).mockResolvedValue({ id: 'existing' });
  await expect(captureWebsiteLead(input)).resolves.toEqual({ ok: true, value: { id: 'existing' } });
  expect(insertLead).not.toHaveBeenCalled();
  expect(findExistingForDedup).toHaveBeenCalledWith(
    input.email,
    expect.stringMatching(/^missing:/),
    'website_form',
  );
});
it('normalizes contacts and keeps PII out of lock keys', async () => {
  await captureWebsiteLead({ ...input, email: 'PERSON@example.com', phone: '+91 98765 43210' });
  expect(insertLead).toHaveBeenCalledWith(
    expect.objectContaining({ email: input.email, phone: '+919876543210' }),
  );
  const keys = (withAdvisoryLocks as jest.Mock).mock.calls[0][0] as string[];
  expect(keys.every((key) => !key.includes('@') && !key.includes('98765'))).toBe(true);
});
it('retains missing contacts without creating fake addresses', async () => {
  await captureWebsiteLead({ ...input, email: '' });
  expect(findExistingForDedup).not.toHaveBeenCalled();
  expect(insertLead).toHaveBeenCalledWith(expect.objectContaining({ email: '', phone: '' }));
});
it('returns a typed error on a database failure', async () => {
  (insertLead as jest.Mock).mockRejectedValue(new Error('database unavailable'));
  await expect(captureWebsiteLead(input)).resolves.toMatchObject({
    ok: false,
    error: { statusCode: 500 },
  });
});
