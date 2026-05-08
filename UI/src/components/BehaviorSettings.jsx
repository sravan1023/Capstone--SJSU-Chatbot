import { useState } from 'react';
import { Check, Sparkles, RotateCcw } from 'lucide-react';

const STYLE_OPTIONS = [
  {
    field: 'response_tone',
    label: 'Tone',
    options: [
      { value: 'professional', label: 'Professional' },
      { value: 'friendly', label: 'Friendly' },
      { value: 'casual', label: 'Casual' },
      { value: 'academic', label: 'Academic' },
    ],
  },
  {
    field: 'response_length',
    label: 'Length',
    options: [
      { value: 'concise', label: 'Concise' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'detailed', label: 'Detailed' },
    ],
  },
  {
    field: 'response_format',
    label: 'Format',
    options: [
      { value: 'plain', label: 'Plain Text' },
      { value: 'markdown', label: 'Rich Text' },
      { value: 'bullet-heavy', label: 'Structured' },
    ],
  },
  {
    field: 'emoji_usage',
    label: 'Emoji',
    options: [
      { value: 'none', label: 'None' },
      { value: 'occasional', label: 'Some' },
      { value: 'frequent', label: 'Lots' },
    ],
  },
];

const PREVIEW_MAP = {
  response_tone: {
    professional: 'I would be happy to assist you with your registration inquiry. Below are the steps required to complete enrollment.',
    friendly: 'Hey! Great question — let me walk you through how to get registered. It\'s pretty straightforward!',
    casual: 'Oh yeah that\'s easy — just hop into MySJSU, hit the enrollment tab, and you\'re good to go.',
    academic: 'The enrollment process follows a structured sequence. First, consult the academic calendar for your registration window.',
  },
  response_length: {
    concise: 'Go to MySJSU > Enrollment > Add Classes. Search by course code and click enroll.',
    balanced: 'To register, log into MySJSU and navigate to the Enrollment section. Search for your course by code or name, then click Enroll. Make sure you\'ve cleared any holds first.',
    detailed: 'To register for classes at SJSU, follow these steps:\n\n1. Log into MySJSU at my.sjsu.edu\n2. Navigate to Student Center > Enrollment\n3. Check your enrollment date on the academic calendar\n4. Search for courses by code, title, or instructor\n5. Add to cart and finalize enrollment\n\nBe sure to resolve any holds (financial, advising) before your window opens.',
  },
  response_format: {
    plain: 'Log into MySJSU, go to Enrollment, search for your class, and click Enroll. Make sure you have no holds on your account first.',
    markdown: '**How to register:**\n\nLog into [MySJSU](https://my.sjsu.edu), navigate to **Enrollment**, and search for your class. Click **Enroll** to confirm.\n\n> Make sure to resolve any holds first.',
    'bullet-heavy': '**Registration steps:**\n\n- Log into MySJSU\n- Go to Student Center > Enrollment\n- Search for your course\n- Click Enroll\n\n**Prerequisites:**\n- No account holds\n- Within your enrollment window',
  },
  emoji_usage: {
    none: 'To register for classes, visit MySJSU and navigate to the Enrollment section.',
    occasional: 'To register for classes, visit MySJSU and head to Enrollment. You\'re all set!',
    frequent: 'To register for classes, visit MySJSU and head to Enrollment! Super easy process — you\'ve got this!',
  },
};

/**
 * BehaviorSettings — style picker with auto-detect awareness.
 *
 * Props:
 *   settings       - current effective settings (auto + manual merged)
 *   autoBehavior   - auto-detected baseline from backend (null = not loaded yet)
 *   manualOverrides - fields the user has explicitly set (object with only overridden keys)
 *   onUpdate       - (updates) => Promise<void>
 *   onResetField   - (field) => void — reset a single field to auto
 *   onResetAll     - () => void — reset all fields to auto
 */
export default function BehaviorSettings({ settings, autoBehavior, manualOverrides, onUpdate, onResetField, onResetAll }) {
  const [saving, setSaving] = useState(null);
  const [previewField, setPreviewField] = useState(null);

  const overrides = manualOverrides || {};
  const hasAnyOverride = Object.keys(overrides).length > 0;

  const handleSelect = async (field, value) => {
    if (settings?.[field] === value) return;
    setSaving(field);
    setPreviewField(field);
    await onUpdate({ [field]: value });
    setSaving(null);
  };

  if (!settings) {
    return (
      <div className="space-y-6 animate-pulse">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center justify-between">
            <div className="h-4 w-20 bg-border-color rounded" />
            <div className="flex gap-1.5">
              {[1, 2, 3].map(j => <div key={j} className="h-8 w-20 bg-border-color/60 rounded-lg" />)}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const activePreviewField = previewField || 'response_tone';
  const previewText = PREVIEW_MAP[activePreviewField]?.[settings[activePreviewField]] || '';

  return (
    <div className="space-y-8">
      {/* Auto-detect banner */}
      {autoBehavior && (
        <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-violet-500/5 border border-violet-500/20">
          <div className="flex items-center gap-2 text-sm text-violet-400">
            <Sparkles size={14} />
            <span>Auto-adapted to your conversation</span>
          </div>
          {hasAnyOverride && onResetAll && (
            <button
              onClick={onResetAll}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-violet-400 hover:bg-violet-500/10 transition-colors"
            >
              <RotateCcw size={12} />
              Reset All to Auto
            </button>
          )}
        </div>
      )}

      {/* Settings rows */}
      <div className="space-y-1">
        {STYLE_OPTIONS.map(({ field, label, options }, idx) => {
          const isSaving = saving === field;
          const selectedValue = settings[field];
          const isOverridden = field in overrides;
          const autoValue = autoBehavior?.[field];

          return (
            <div key={field}>
              <div className={`flex items-center justify-between py-3.5 transition-opacity ${isSaving ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text-primary">{label}</span>
                  {isOverridden && (
                    <button
                      onClick={() => onResetField?.(field)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-violet-400 hover:bg-violet-500/10 transition-colors"
                      title={`Auto-detected: ${autoValue}. Click to reset.`}
                    >
                      <RotateCcw size={10} />
                      Auto
                    </button>
                  )}
                  {!isOverridden && autoBehavior && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-violet-400/60">
                      <Sparkles size={9} />
                      Auto
                    </span>
                  )}
                </div>

                {/* Segmented control */}
                <div className="flex bg-bg-main rounded-lg p-0.5 gap-0.5">
                  {options.map((opt) => {
                    const isSelected = selectedValue === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => handleSelect(field, opt.value)}
                        disabled={isSaving}
                        className={`relative px-3.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                          isSelected
                            ? 'bg-bg-surface text-text-primary shadow-sm ring-1 ring-border-color'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        {isSelected && (
                          <Check
                            size={10}
                            strokeWidth={3}
                            className="inline-block mr-1 text-sjsu-gold -mt-px"
                          />
                        )}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {idx < STYLE_OPTIONS.length - 1 && (
                <div className="border-b border-border-color/50" />
              )}
            </div>
          );
        })}
      </div>

      {/* Live preview */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Preview</span>
          <div className="flex-1 h-px bg-border-color/50" />
        </div>
        <div className="rounded-xl bg-bg-main border border-border-color/60 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-sjsu-gold to-orange-400 flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-[10px] font-bold text-white">S</span>
            </div>
            <p className="text-sm text-text-primary leading-relaxed whitespace-pre-line">{previewText}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
