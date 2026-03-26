export interface SurfaceAction {
    id: string;
    label: string;
    action: string;
    style: 'primary' | 'secondary' | 'destructive';
    value?: unknown;
    opens_artifact?: string;
}
