export type NotificationType = 'permission_prompt' | 'idle_prompt';

export interface NotificationEntry {
    timestamp: string;
    session_id: string;
    notification_type: NotificationType;
    message?: string;
}

export type ActiveNotificationKind = 'permission' | 'idle';

export interface ActiveNotification {
    kind: ActiveNotificationKind;
    timestamp: Date;
}
