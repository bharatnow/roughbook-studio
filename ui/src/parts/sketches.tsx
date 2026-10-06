import { useCallback, useEffect, useState } from 'react';
import { get, post } from '../api';
import { describe, useStudio } from '../data';
import type { PullableSketch } from '../types';

/**
 * The component's web sketches. Pulling one makes the next local iteration from its files, which
 * is then reviewed, refined and promoted here like any other.
 */
export function WebSketches({
  page,
  component,
  pulledAs,
  webBase
}: {
  page: string;
  component: string;
  /** Sketch id → the iteration in this repo pulled from it. */
  pulledAs: Map<string, string>;
  /** The component on the web, where each sketch can be seen; null when offline. */
  webBase: string | null;
}) {
  const { say, refresh } = useStudio();
  const [sketches, setSketches] = useState<PullableSketch[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pulling, setPulling] = useState<string | null>(null);
  const path = `/api/sketches/${encodeURIComponent(page)}/${encodeURIComponent(component)}`;

  const load = useCallback(async () => {
    try {
      setSketches(await get<PullableSketch[]>(path));
      setProblem(null);
    } catch (error) {
      setProblem(describe(error));
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pull(sketch: PullableSketch) {
    setPulling(sketch.id);
    try {
      const pulled = await post<{ iteration: string; advice: string[] }>(
        `${path}/${encodeURIComponent(sketch.id)}/pull`
      );
      say({
        tone: 'info',
        text: [`Pulled ${sketch.id} into rough/ as ${pulled.iteration}.`, ...pulled.advice].join(
          ' '
        )
      });
      await refresh();
    } catch (error) {
      say({ tone: 'error', text: describe(error) });
    } finally {
      setPulling(null);
    }
  }

  return (
    <section className="rounded-card border border-ash bg-canvas p-4">
      <h2 className="font-display text-base tracking-tight text-graphite">From the web</h2>
      {problem ? (
        <p className="mt-2 text-sm text-danger">{problem}</p>
      ) : sketches === null ? (
        <p className="mt-2 text-sm text-slate">Loading…</p>
      ) : !sketches.length ? (
        <p className="mt-2 text-sm text-slate">
          No web sketches of this component yet. One made on the web can be pulled here as a local
          iteration.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-steel">
            Pull a sketch to make it the next iteration in this repo.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {sketches.map(sketch => {
              const pulled = pulledAs.get(sketch.id);
              return (
                <li key={sketch.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-graphite">{sketch.name}</p>
                    <p className="font-mono text-[11px] text-steel">
                      {sketch.id}
                      {sketch.status === 'exploring' ? '' : ` · ${sketch.status}`}
                      {pulled ? ` · pulled as ${pulled}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {webBase ? (
                      <a
                        href={`${webBase}/${sketch.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-violet hover:underline"
                      >
                        View
                      </a>
                    ) : null}
                    <button
                      type="button"
                      disabled={pulling !== null}
                      onClick={() => void pull(sketch)}
                      className="inline-flex h-7 items-center rounded-control border border-ash bg-canvas px-2.5 text-sm text-graphite hover:border-mist hover:bg-frost disabled:opacity-50"
                    >
                      {pulling === sketch.id ? 'Pulling…' : pulled ? 'Pull again' : 'Pull'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
