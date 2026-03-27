import type { BaseContract } from '@aura/contract-runtime';
import type { AuraPluginConfig } from '../config/schema.js';
import type { PluginLogger } from '../types/plugin-types.js';

export class EngramCompletionBridge {
    constructor(config: AuraPluginConfig, logger: PluginLogger);
    onComplete(contract: BaseContract): Promise<void>;
}
