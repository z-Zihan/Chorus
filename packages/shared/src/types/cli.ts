export type CliReadiness = "ready" | "installed" | "needs_auth" | "unsupported" | "error";

export type CliDetectionSource = "process_path" | "login_shell" | "known_dir" | "user_selected";

export interface CliDetection {
  id: string;
  descriptorId: string;
  displayName: string;
  executablePath: string;
  resolvedPath: string;
  version?: string;
  status: CliReadiness;
  source: CliDetectionSource;
  diagnosticsCode?: string;
  detectedAt: number;
  fingerprint: string;
}

export type OnboardingStep =
  | "bootstrapping"
  | "scanning"
  | "choose_agent"
  | "needs_auth"
  | "none_found"
  | "creating_workspace"
  | "completed"
  | "error";

export interface OnboardingStatus {
  step: OnboardingStep;
  detections: CliDetection[];
  detection?: CliDetection;
  scanId?: string;
  agentId?: string;
  conversationId?: string;
  code?: string;
  recoverable?: boolean;
}
