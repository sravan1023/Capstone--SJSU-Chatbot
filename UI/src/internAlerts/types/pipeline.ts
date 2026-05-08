export type PipelineRunStatus = 'running' | 'success' | 'failed';

export interface PipelineRun {
  id: string;
  pipeline_key: string;
  status: PipelineRunStatus;
  top_count: number;
  new_jobs_count: number;
  email_sent: boolean;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface SnapshotJob {
  id: number;
  run_id: string;
  rank_position: number;
  company: string;
  title: string;
  job_url: string;
  source_record_id: string | null;
  raw_record: Record<string, unknown> | null;
  created_at: string;
}

export interface PipelineState {
  pipeline_key: string;
  previous_top_url: string | null;
  updated_at: string;
  last_success_at: string | null;
  last_run_id: string | null;
}

export interface DashboardPayload {
  latestRun: PipelineRun | null;
  jobs: SnapshotJob[];
  state: PipelineState | null;
}
