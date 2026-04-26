export type NotificationKind = 'permission' | 'idle';

export interface NotificationEntry {
    timestamp: string;
    session_id: string;
    notification_type: string;
    message?: string;
}

export interface NotificationState {
    type: NotificationKind;
    timestamp: Date;
}
