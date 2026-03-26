export interface ResumeToken {
    token: string;
    expiresAt: string;
}

export function generateResumeToken(): ResumeToken;
export function isTokenExpired(expiresAt: string): boolean;
