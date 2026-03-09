export type ScheduledJobAction = {
  type: "message";
  prompt: string;
};

export type ScheduledJobSpec = {
  id: string;
  sourcePath: string;
  date: string | null;
  time: string;
  hour: number;
  minute: number;
  disabled: boolean;
  action: ScheduledJobAction;
};

export type DetectedScheduledJobDefinition = {
  sourcePath: string;
  raw: unknown;
};

export type ScheduledJobIssue = {
  sourcePath: string;
  message: string;
};

export type ScheduledJobDetectionResult = {
  definitions: DetectedScheduledJobDefinition[];
  errors: ScheduledJobIssue[];
};
