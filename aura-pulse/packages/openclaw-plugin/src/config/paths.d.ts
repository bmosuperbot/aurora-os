export interface ParaRoots {
    projects: string;
    areas: string;
    resources: string;
    archive: string;
    trash: string;
}

export interface AuraPaths {
    auraRoot: string;
    sharedDir: string;
    dbPath: string;
    signalPath: string;
    artifactsDir: string;
    projectsDir: string;
    para: ParaRoots;
}

export function resolveAuraRoot(auraRoot: string): string;
export function resolveAuroraPackageDir(auraRoot: string, packageId: string): string;
export function resolvePaths(config: import('./schema.js').AuraPluginConfig): AuraPaths;
