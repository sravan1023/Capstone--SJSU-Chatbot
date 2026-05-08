import { internAlertsSupabase } from './supabase';
import type { DashboardPayload, PipelineRun, PipelineState, SnapshotJob } from '../types/pipeline';

const PIPELINE_KEY = 'intern_jobs_alert';

export interface PipelineTriggerResult {
  runId: string;
  topCount: number;
  newJobsCount: number;
  emailSent: boolean;
  previousTopUrl: string | null;
  nextTopUrl: string | null;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || 'http://localhost:8000';

export async function triggerInternJobsPipeline(): Promise<PipelineTriggerResult> {
  const response = await fetch(`${API_BASE}/api/intern-jobs/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body?.ok === false) {
    throw new Error(body?.detail ?? body?.error ?? body?.message ?? `Pipeline trigger failed (${response.status}).`);
  }

  return body.result as PipelineTriggerResult;
}

export async function fetchInternJobsDashboard(): Promise<DashboardPayload> {
  const [{ data: latestRun, error: latestRunError }, { data: state, error: stateError }] = await Promise.all([
    internAlertsSupabase
      .from('pipeline_runs')
      .select('*')
      .eq('pipeline_key', PIPELINE_KEY)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<PipelineRun>(),
    internAlertsSupabase
      .from('pipeline_state')
      .select('*')
      .eq('pipeline_key', PIPELINE_KEY)
      .maybeSingle<PipelineState>(),
  ]);

  if (latestRunError) {
    throw new Error(`Failed to fetch latest run: ${latestRunError.message}`);
  }

  if (stateError) {
    throw new Error(`Failed to fetch pipeline state: ${stateError.message}`);
  }

  if (!latestRun) {
    return {
      latestRun: null,
      jobs: [],
      state: state ?? null,
    };
  }

  const { data: jobs, error: jobsError } = await internAlertsSupabase
    .from('jobs_snapshot')
    .select('*')
    .eq('run_id', latestRun.id)
    .order('rank_position', { ascending: true })
    .limit(100)
    .returns<SnapshotJob[]>();

  if (jobsError) {
    throw new Error(`Failed to fetch snapshot jobs: ${jobsError.message}`);
  }

  return {
    latestRun,
    jobs: jobs ?? [],
    state: state ?? null,
  };
}

export async function fetchRecentPipelineRuns(limit = 30): Promise<PipelineRun[]> {
  const { data, error } = await internAlertsSupabase
    .from('pipeline_runs')
    .select('*')
    .eq('pipeline_key', PIPELINE_KEY)
    .order('started_at', { ascending: false })
    .limit(limit)
    .returns<PipelineRun[]>();

  if (error) {
    throw new Error(`Failed to fetch pipeline runs: ${error.message}`);
  }

  return data ?? [];
}
