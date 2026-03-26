export interface ClarificationEntry {
    id: string;
    timestamp: string;
    participant: string;
    role: 'question' | 'answer' | 'surface_update';
    content: string;
    surface_version?: number;
}
