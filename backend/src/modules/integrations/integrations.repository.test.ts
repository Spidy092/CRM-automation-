jest.mock('../../shared/utils/db', () => ({
  pool: { query: jest.fn() },
  query: jest.fn(),
  queryOne: jest.fn(),
}));

import { query, queryOne } from '../../shared/utils/db';
import {
  findAll,
  findAllPublic,
  findById,
  findByName,
  findCredentialsById,
  updateIntegration,
  recordTestResult,
} from './integrations.repository';

const mockQuery = query as jest.Mock;
const mockQueryOne = queryOne as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('findAll', () => {
  it('returns all integrations', async () => {
    mockQuery.mockResolvedValue([{ id: 'i1', name: 'whatsapp' }]);
    const result = await findAll();
    expect(result).toHaveLength(1);
  });
});

describe('findAllPublic', () => {
  it('returns public integrations', async () => {
    mockQuery.mockResolvedValue([{ id: 'i1', name: 'whatsapp' }]);
    const result = await findAllPublic();
    expect(result).toHaveLength(1);
  });
});

describe('findById', () => {
  it('returns integration when found', async () => {
    mockQueryOne.mockResolvedValue({ id: 'i1', name: 'whatsapp' });
    const result = await findById('i1');
    expect(result?.id).toBe('i1');
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findById('x')).toBeNull();
  });
});

describe('findByName', () => {
  it('returns integration by name', async () => {
    mockQueryOne.mockResolvedValue({ id: 'i1', name: 'whatsapp' });
    const result = await findByName('whatsapp');
    expect(result?.name).toBe('whatsapp');
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findByName('missing')).toBeNull();
  });
});

describe('findCredentialsById', () => {
  it('returns credentials', async () => {
    mockQueryOne.mockResolvedValue({ encrypted_credentials: 'enc-data' });
    const result = await findCredentialsById('i1');
    expect(result).toBe('enc-data');
  });

  it('returns null when no credentials', async () => {
    mockQueryOne.mockResolvedValue({ encrypted_credentials: null });
    expect(await findCredentialsById('i1')).toBeNull();
  });

  it('returns null when row not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await findCredentialsById('x')).toBeNull();
  });
});

describe('updateIntegration', () => {
  it('updates isEnabled', async () => {
    mockQueryOne.mockResolvedValue({ id: 'i1', is_enabled: true });
    const result = await updateIntegration('i1', { isEnabled: true, updatedBy: 'u1' });
    expect(result.is_enabled).toBe(true);
  });

  it('updates encryptedCredentials', async () => {
    mockQueryOne.mockResolvedValue({ id: 'i1' });
    await updateIntegration('i1', { encryptedCredentials: 'enc', updatedBy: 'u1' });
    expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining('encrypted_credentials'), expect.any(Array));
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(updateIntegration('x', { isEnabled: true, updatedBy: 'u1' })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('recordTestResult', () => {
  it('records ok status', async () => {
    mockQueryOne.mockResolvedValue({ id: 'i1', last_test_status: 'ok' });
    const result = await recordTestResult('i1', 'ok');
    expect(result.last_test_status).toBe('ok');
  });

  it('throws 404 when not found', async () => {
    mockQueryOne.mockResolvedValue(null);
    await expect(recordTestResult('x', 'ok')).rejects.toMatchObject({ statusCode: 404 });
  });
});
