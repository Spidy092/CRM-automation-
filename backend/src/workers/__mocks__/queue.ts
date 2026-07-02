export const Queue = jest.fn();
export const Worker = jest.fn();
export const getBullConnection = jest.fn();
export const queues = {};

// Job scheduling helpers used by agent-planner tests
export const enqueueLeadEvent = jest.fn();
export const cancelPendingOutreachJobs = jest.fn();
export const enqueueScoringJob = jest.fn();
export const enqueueOutreachJob = jest.fn();
export const enqueueAssignmentJob = jest.fn();
export const enqueueAiResearchJob = jest.fn();
export const enqueueAiReplyJob = jest.fn();
export const enqueueAiCampaignBrief = jest.fn();
export const enqueueReportExportJob = jest.fn();
export const enqueueScraperJob = jest.fn();
