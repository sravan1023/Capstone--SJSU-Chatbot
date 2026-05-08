import { useState, useMemo } from 'react';
import { Check, Shield, Target, Zap, Heart, Scale } from 'lucide-react';

/**
 * PrioritySettings — preset picker.
 *
 * Instead of making users drag-rank 6+ abstract priorities, we surface a few
 * named presets that each map to a priority_stack. Power users who really
 * want a custom order can still set one via the backend directly, but this
 * keeps the UI honest about what 95% of users actually need.
 */

const BASE_STACK = [
  'safety',
  'accuracy',
  'task_completion',
  'clarity',
  'speed',
  'warmth',
  'creativity',
  'personalization',
];

const PRESETS = [
  {
    id: 'balanced',
    label: 'Balanced',
    desc: 'The default. Safety first, then accuracy, then getting the job done.',
    icon: Scale,
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    stack: BASE_STACK,
  },
  {
    id: 'accuracy',
    label: 'Accuracy First',
    desc: 'Prioritize factual correctness and sources over speed or brevity.',
    icon: Target,
    color: 'text-emerald-500',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    stack: ['safety', 'accuracy', 'clarity', 'task_completion', 'speed', 'warmth', 'creativity', 'personalization'],
  },
  {
    id: 'speed',
    label: 'Speed First',
    desc: 'Quick, direct answers. Skip preamble and extra explanation.',
    icon: Zap,
    color: 'text-amber-500',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    stack: ['safety', 'speed', 'task_completion', 'accuracy', 'clarity', 'warmth', 'creativity', 'personalization'],
  },
  {
    id: 'warmth',
    label: 'Supportive',
    desc: 'Empathetic, encouraging tone. Good for stressful topics.',
    icon: Heart,
    color: 'text-pink-500',
    bg: 'bg-pink-500/10',
    border: 'border-pink-500/30',
    stack: ['safety', 'warmth', 'accuracy', 'clarity', 'task_completion', 'speed', 'personalization', 'creativity'],
  },
  {
    id: 'safety',
    label: 'Cautious',
    desc: 'Extra disclaimers on sensitive topics. Conservative advice.',
    icon: Shield,
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    stack: ['safety', 'accuracy', 'clarity', 'warmth', 'task_completion', 'speed', 'creativity', 'personalization'],
  },
];

/** Guess which preset the current stack matches (first matching head-of-stack wins). */
function detectPreset(stack) {
  if (!Array.isArray(stack) || stack.length === 0) return 'balanced';
  // Match by the first 3 priorities — that's what meaningfully differentiates presets.
  const head = stack.slice(0, 3).join(',');
  for (const p of PRESETS) {
    if (p.stack.slice(0, 3).join(',') === head) return p.id;
  }
  return 'custom';
}

export default function PrioritySettings({ stack, onUpdate }) {
  const [saving, setSaving] = useState(null);
  const activeId = useMemo(() => detectPreset(stack), [stack]);

  const handleSelect = async (preset) => {
    if (preset.id === activeId) return;
    setSaving(preset.id);
    try {
      await onUpdate({ priority_stack: preset.stack });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      {PRESETS.map((preset) => {
        const Icon = preset.icon;
        const isActive = activeId === preset.id;
        const isSaving = saving === preset.id;
        return (
          <button
            key={preset.id}
            onClick={() => handleSelect(preset)}
            disabled={isSaving}
            className={`w-full text-left flex items-start gap-3 p-4 rounded-xl border transition-all ${
              isActive
                ? `${preset.bg} ${preset.border}`
                : 'bg-bg-surface border-border-color hover:border-text-secondary/30'
            } ${isSaving ? 'opacity-60' : ''}`}
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${preset.bg} border ${preset.border}`}>
              <Icon size={18} className={preset.color} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${isActive ? preset.color : 'text-text-primary'}`}>
                  {preset.label}
                </span>
                {isActive && (
                  <Check size={14} strokeWidth={3} className={preset.color} />
                )}
              </div>
              <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{preset.desc}</p>
            </div>
          </button>
        );
      })}

      {activeId === 'custom' && (
        <p className="text-[11px] text-text-secondary leading-relaxed pt-1">
          Your current priority order doesn't match any preset. Pick one above to reset to a known configuration.
        </p>
      )}
    </div>
  );
}
