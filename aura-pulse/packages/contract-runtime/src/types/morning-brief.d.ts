import type { AutonomousLogEntry } from './autonomous-log.js';

export interface MorningBriefPendingDecision {
    id: string;
    goal: string;
    agent_name?: string;
}

export interface MorningBriefRecommendationContext {
    autonomous_actions?: AutonomousLogEntry[];
    pending_decisions?: MorningBriefPendingDecision[];
    patterns_observed?: string[];
}