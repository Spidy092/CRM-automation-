import { EventEmitter } from 'events';
import { lookup } from 'dns/promises';
import { request } from 'https';
import { readPublicWebsite } from './google-agent.network';

jest.mock('dns/promises', () => ({
  lookup: jest.fn(),
  default: { resolve: jest.fn().mockResolvedValue(['93.184.216.34']) },
}));
jest.mock('https', () => ({ request: jest.fn() }));
jest.mock('http', () => ({ request: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  (lookup as jest.Mock).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});
it.each([
  '127.0.0.1',
  '10.0.0.1',
  '169.254.169.254',
  '::1',
  '::ffff:127.0.0.1',
  'fc12::1',
  'fd44::1',
  'fea0::1',
  'ff02::1',
  '224.0.0.1',
])('blocks private/mapped/multicast DNS address %s before opening a socket', async (address) => {
  (lookup as jest.Mock).mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
  await expect(readPublicWebsite('https://clinic.test/', 100)).rejects.toThrow('blocked address');
  expect(request).not.toHaveBeenCalled();
});
it('fails closed if DNS lookup fails or resolves no addresses', async () => {
  (lookup as jest.Mock).mockRejectedValueOnce(new Error('DNS failure'));
  await expect(readPublicWebsite('https://clinic.test/', 100)).rejects.toThrow('DNS failure');
  (lookup as jest.Mock).mockResolvedValueOnce([]);
  await expect(readPublicWebsite('https://clinic.test/', 100)).rejects.toThrow('blocked address');
});
it('rejects internal URLs and credentials before DNS lookup', async () => {
  await expect(readPublicWebsite('http://localhost/', 100)).rejects.toThrow();
  await expect(readPublicWebsite('https://fixture@clinic.test/', 100)).rejects.toThrow(
    'credentials',
  );
  expect(lookup).not.toHaveBeenCalled();
});
it('pins the resolved address and bounds the response body', async () => {
  const socket = new EventEmitter() as EventEmitter & {
    end: () => void;
    destroy: (error: Error) => void;
  };
  let responseCallback: (response: EventEmitter & { headers: object; statusCode: number }) => void;
  (request as jest.Mock).mockImplementation((_url, _options, callback) => {
    responseCallback = callback;
    return socket;
  });
  socket.destroy = (error) => {
    socket.emit('error', error);
    socket.emit('close');
  };
  socket.end = () => {
    const response = Object.assign(new EventEmitter(), {
      headers: { 'content-type': 'text/html' },
      statusCode: 200,
    });
    responseCallback(response);
    response.emit('data', Buffer.from('<body>Hello</body>'));
    response.emit('end');
    socket.emit('close');
  };
  expect((await readPublicWebsite('https://clinic.test/', 100)).text).toBe('<body>Hello</body>');
  const options = (request as jest.Mock).mock.calls[0][1];
  const callback = jest.fn();
  options.lookup('clinic.test', { all: false }, callback);
  expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  options.lookup('clinic.test', { all: true }, callback);
  expect(callback).toHaveBeenLastCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  socket.end = () => {
    const response = Object.assign(new EventEmitter(), { headers: {}, statusCode: 200 });
    responseCallback(response);
    response.emit('data', Buffer.alloc(129 * 1024));
  };
  await expect(readPublicWebsite('https://clinic.test/', 100)).rejects.toThrow('size limit');
});

it('bounds DNS resolution time without opening a socket', async () => {
  jest.useFakeTimers();
  try {
    (lookup as jest.Mock).mockImplementation(() => new Promise(() => undefined));
    const assertion = expect(readPublicWebsite('https://clinic.test/', 10)).rejects.toThrow(
      'timed out',
    );
    await jest.advanceTimersByTimeAsync(20);
    await assertion;
    expect(request).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
