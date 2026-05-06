import { useCallback, useRef, useState } from 'react';
import type { SnapshotJob } from '../types/pipeline';

interface JobsDashboardTableProps {
  jobs: SnapshotJob[];
}

const DEFAULT_WIDTHS = [52, 170, 420, 240, 120];

export default function JobsDashboardTable({ jobs }: JobsDashboardTableProps) {
  const [colWidths, setColWidths] = useState<number[]>(DEFAULT_WIDTHS);
  const dragRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);
  const totalWidth = colWidths.reduce((a, b) => a + b, 0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, colIdx: number) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    },
    [colWidths],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const { colIdx, startX, startW } = dragRef.current;
    const newW = Math.max(40, startW + (e.clientX - startX));
    setColWidths((prev) => {
      const next = [...prev];
      next[colIdx] = newW;
      return next;
    });
  }, []);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (jobs.length === 0) {
    return <div className="rounded-xl border border-border-color bg-bg-surface p-4 text-sm text-text-secondary">No jobs in the latest snapshot.</div>;
  }

  const headers = ['#', 'Company', 'Title', 'Location', 'Open Link'];

  return (
    <div
      className="overflow-auto rounded-2xl border border-border-color bg-bg-surface shadow-sm ring-1 ring-black/5"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <table className="table-fixed text-[13px] text-text-primary" style={{ width: `max(100%, ${totalWidth}px)` }}>
        <thead className="sticky top-0 z-10 bg-bg-main/95 backdrop-blur text-[11px] uppercase tracking-[0.08em] text-text-secondary">
          <tr className="border-b border-border-color/80">
            {headers.map((h, i) => (
              <th
                key={h}
                className="relative select-none px-4 py-3 text-left font-semibold"
                style={{ width: colWidths[i], minWidth: 40 }}
              >
                {h}
                {i < headers.length - 1 && (
                  <span
                    className="absolute right-0 top-1/4 h-1/2 w-px bg-border-color/80 cursor-col-resize hover:w-0.5 hover:bg-sjsu-gold/70"
                    onPointerDown={(e) => onPointerDown(e, i)}
                    style={{ padding: '0 2px', backgroundClip: 'content-box' }}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            const location = (job.raw_record?.location as string) || '—';
            return (
              <tr
                key={job.id}
                className="border-b border-border-color/50 odd:bg-bg-surface even:bg-bg-main/30 transition-colors hover:bg-bg-hover/70"
              >
                <td className="whitespace-nowrap px-4 py-3 text-text-secondary tabular-nums">{job.rank_position}</td>
                <td className="whitespace-nowrap px-4 py-3 font-semibold truncate" title={job.company}>{job.company}</td>
                <td className="whitespace-nowrap px-4 py-3 truncate" title={job.title}>{job.title}</td>
                <td className="whitespace-nowrap px-4 py-3 text-text-secondary truncate" title={location}>{location}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  <a
                    href={job.job_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-sjsu-gold/40 bg-sjsu-gold/10 px-2.5 py-1 text-xs font-semibold text-sjsu-gold transition-colors hover:border-sjsu-gold hover:bg-sjsu-gold/20 hover:text-sjsu-gold-hover"
                  >
                    Open ↗
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
