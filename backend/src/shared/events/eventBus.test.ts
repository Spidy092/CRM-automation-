const mockQueueAdd = jest.fn();
const MockQueue = jest.fn().mockImplementation(() => ({
  add: mockQueueAdd,
}));

jest.mock('bullmq', () => ({
  Queue: MockQueue,
}));

jest.mock('../../workers/queue', () => ({
  AI_EVENTS_QUEUE: 'ai-events',
  getBullConnection: jest.fn(() => ({ on: jest.fn(), ping: jest.fn() })),
}));

jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { logger } from '../utils/logger';
import {
  publishAIDomainEvent,
  subscribeToAIDomainEvents,
  getHandlersForEvent,
} from './eventBus';
import { type AIDomainEvent, aiEventIdempotencyKey } from './ai.events';
import { AI_EVENTS_QUEUE } from '../../workers/queue';

const mockedLogger = logger as jest.Mocked<typeof logger>;

describe('eventBus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('publishAIDomainEvent', () => {
    it('enqueues a lead event with a deterministic job id', async () => {
      const event: AIDomainEvent = { type: 'lead.scraped', payload: { lead_id: 'lead-1' } };
      mockQueueAdd.mockResolvedValue(undefined);

      await publishAIDomainEvent(event);

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Publishing AI domain event',
        expect.objectContaining({ event: 'lead.scraped', leadId: 'lead-1' }),
      );
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
      expect(mockQueueAdd).toHaveBeenCalledWith(
        AI_EVENTS_QUEUE,
        expect.objectContaining({
          event: 'lead.scraped',
          payload: event.payload,
          enqueuedAt: expect.any(String),
        }),
        { jobId: aiEventIdempotencyKey(event) },
      );
    });

    it('enqueues a campaign event when lead_id is absent', async () => {
      const event: AIDomainEvent = { type: 'campaign.pre_launch', payload: { campaign_id: 'camp-1' } };
      mockQueueAdd.mockResolvedValue(undefined);

      await publishAIDomainEvent(event);

      expect(mockedLogger.info).toHaveBeenCalledWith(
        'Publishing AI domain event',
        expect.objectContaining({ event: 'campaign.pre_launch', campaignId: 'camp-1' }),
      );
      expect(mockQueueAdd).toHaveBeenCalledWith(
        AI_EVENTS_QUEUE,
        expect.anything(),
        { jobId: aiEventIdempotencyKey(event) },
      );
    });

    it('logs an error but does not throw when queue.add fails', async () => {
      const event: AIDomainEvent = { type: 'lead.imported', payload: { lead_id: 'lead-2' } };
      const err = new Error('redis down');
      mockQueueAdd.mockRejectedValue(err);

      await expect(publishAIDomainEvent(event)).resolves.toBeUndefined();

      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Failed to publish AI domain event',
        expect.objectContaining({
          event: 'lead.imported',
          leadId: 'lead-2',
          error: 'redis down',
        }),
      );
    });

    it('logs a stringified error when the rejection is not an Error instance', async () => {
      const event: AIDomainEvent = { type: 'lead.imported', payload: { lead_id: 'lead-3' } };
      mockQueueAdd.mockRejectedValue('connection refused');

      await expect(publishAIDomainEvent(event)).resolves.toBeUndefined();

      expect(mockedLogger.error).toHaveBeenCalledWith(
        'Failed to publish AI domain event',
        expect.objectContaining({
          event: 'lead.imported',
          leadId: 'lead-3',
          error: 'connection refused',
        }),
      );
    });
  });

  describe('subscribeToAIDomainEvents', () => {
    it('registers a handler and returns it via getHandlersForEvent', () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      const unsubscribe = subscribeToAIDomainEvents({ 'lead.scraped': handler });

      try {
        const handlers = getHandlersForEvent('lead.scraped');
        expect(handlers).toHaveLength(1);
        expect(handlers[0]).toBe(handler);
      } finally {
        unsubscribe();
      }
    });

    it('registers handlers for multiple event types', () => {
      const scrapedHandler = jest.fn().mockResolvedValue(undefined);
      const importedHandler = jest.fn().mockResolvedValue(undefined);

      const unsubscribe = subscribeToAIDomainEvents({
        'lead.scraped': scrapedHandler,
        'lead.imported': importedHandler,
      });

      try {
        expect(getHandlersForEvent('lead.scraped')).toHaveLength(1);
        expect(getHandlersForEvent('lead.imported')).toHaveLength(1);
        expect(getHandlersForEvent('campaign.pre_launch')).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    });

    it('returns an unsubscribe function that removes only the registered handlers', () => {
      const handlerA = jest.fn().mockResolvedValue(undefined);
      const handlerB = jest.fn().mockResolvedValue(undefined);

      const unsubscribeA = subscribeToAIDomainEvents({ 'lead.reply.received': handlerA });
      const unsubscribeB = subscribeToAIDomainEvents({ 'lead.reply.received': handlerB });

      expect(getHandlersForEvent('lead.reply.received')).toHaveLength(2);

      unsubscribeA();

      const remaining = getHandlersForEvent('lead.reply.received');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(handlerB);

      unsubscribeB();
      expect(getHandlersForEvent('lead.reply.received')).toHaveLength(0);
    });

    it('removes the event type entry when the last handler is unsubscribed', () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      const unsubscribe = subscribeToAIDomainEvents({ 'lead.stage.changed': handler });
      expect(getHandlersForEvent('lead.stage.changed')).toHaveLength(1);

      unsubscribe();
      expect(getHandlersForEvent('lead.stage.changed')).toHaveLength(0);
    });

    it('ignores undefined/null handlers', () => {
      const handler = jest.fn().mockResolvedValue(undefined);

      const unsubscribe = subscribeToAIDomainEvents({
        'outreach.bounced': handler,
        'outreach.opened': undefined,
        'outreach.clicked': null as unknown as undefined,
      });

      try {
        expect(getHandlersForEvent('outreach.bounced')).toHaveLength(1);
        expect(getHandlersForEvent('outreach.opened')).toHaveLength(0);
        expect(getHandlersForEvent('outreach.clicked')).toHaveLength(0);
      } finally {
        unsubscribe();
      }
    });

    it('returns an empty array for event types with no handlers', () => {
      expect(getHandlersForEvent('campaign.pre_launch')).toEqual([]);
    });

    it('returns handlers in the order they were registered', () => {
      const first = jest.fn().mockResolvedValue(undefined);
      const second = jest.fn().mockResolvedValue(undefined);

      const unsubscribeFirst = subscribeToAIDomainEvents({ 'lead.score.updated': first });
      const unsubscribeSecond = subscribeToAIDomainEvents({ 'lead.score.updated': second });

      try {
        const handlers = getHandlersForEvent('lead.score.updated');
        expect(handlers).toEqual([first, second]);
      } finally {
        unsubscribeFirst();
        unsubscribeSecond();
      }
    });
  });
});
