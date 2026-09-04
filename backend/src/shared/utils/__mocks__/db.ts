export const pool = {
  query: jest.fn(),
  connect: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined),
};

export const query = jest.fn();
export const queryOne = jest.fn();
export const withTransaction = jest.fn();
export const checkDbConnection = jest.fn();
