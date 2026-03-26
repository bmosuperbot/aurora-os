import type { ContractTypeDefinition } from '../runtime/type-registry.js';

export interface OfferReceivedContext {
    platform: 'poshmark' | 'etsy' | 'mercari';
    listing_id: string;
    listing_title: string;
    asking_price: number;
    offer_amount: number;
    buyer_id: string;
    budget_threshold?: number;
    vendor_history?: Array<{ date: string; outcome: string; amount: number }>;
}

export const offerReceivedType: ContractTypeDefinition;
