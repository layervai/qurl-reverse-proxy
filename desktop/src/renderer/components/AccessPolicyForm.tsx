import { useState, useCallback } from 'react';

interface AccessPolicyFormProps {
  value: Partial<QURLCreateInput>;
  onChange: (input: Partial<QURLCreateInput>) => void;
  compact?: boolean;
  /** When true, hides the simple tier (expiry, one-time, max sessions) and shows only advanced policy settings */
  advancedOnly?: boolean;
}

const EXPIRY_OPTIONS = [
  { label: '15 minutes', value: '15m' },
  { label: '1 hour', value: '1h' },
  { label: '6 hours', value: '6h' },
  { label: '24 hours', value: '24h' },
  { label: '7 days', value: '7d' },
];

const SESSION_DURATION_OPTIONS = [
  { label: '15 minutes', value: '15m' },
  { label: '1 hour', value: '1h' },
  { label: '6 hours', value: '6h' },
  { label: '24 hours', value: '24h' },
];

const AI_CATEGORIES = ['search_crawlers', 'llm_scrapers', 'ai_assistants', 'training_bots'];

const AI_CATEGORY_LABELS: Record<string, string> = {
  search_crawlers: 'Search crawlers',
  llm_scrapers: 'LLM scrapers',
  ai_assistants: 'AI assistants',
  training_bots: 'Training bots',
};

// Shared label style for field alignment
const LABEL_CLS = 'text-xs font-medium text-text-secondary mb-1 block';

export function AccessPolicyForm({ value, onChange, compact = false, advancedOnly = false }: AccessPolicyFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const policy = value.access_policy || {};

  const updateField = useCallback(
    <K extends keyof QURLCreateInput>(field: K, val: QURLCreateInput[K] | undefined) => {
      onChange({ ...value, [field]: val });
    },
    [value, onChange],
  );

  const updatePolicy = useCallback(
    (patch: Partial<AccessPolicy>) => {
      onChange({
        ...value,
        access_policy: { ...policy, ...patch },
      });
    },
    [value, policy, onChange],
  );

  return (
    <div className={`flex flex-col ${compact ? 'gap-2.5' : 'gap-3'}`}>
      {/* Simple tier: expiry, one-time, max sessions (hidden when advancedOnly) */}
      {!advancedOnly && (
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
        {/* Expiry */}
        <div>
          <label className={LABEL_CLS}>Expiry</label>
          <select
            value={value.expires_in || '1h'}
            onChange={(e) => updateField('expires_in', e.target.value)}
            className="w-full"
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* One-time use */}
        <div>
          <label className={LABEL_CLS}>One-time use</label>
          <button
            type="button"
            onClick={() => updateField('one_time_use', !value.one_time_use)}
            className={`
              flex items-center gap-2.5 rounded-lg cursor-pointer transition-all duration-200 border
              ${value.one_time_use
                ? 'bg-accent-dim border-accent-border'
                : 'bg-surface-1 border-glass-border hover:border-glass-border-hover'
              }
            `}
            style={{ padding: '10px 14px' }}
          >
            <span
              className={`
                relative w-8 h-[18px] rounded-full shrink-0 transition-colors duration-200
                ${value.one_time_use ? 'bg-accent' : 'bg-surface-3'}
              `}
            >
              <span
                className={`
                  absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-[left] duration-200
                  ${value.one_time_use ? 'left-[15px]' : 'left-[2px]'}
                `}
              />
            </span>
            <span className={`text-[13px] font-medium transition-colors duration-150 whitespace-nowrap ${value.one_time_use ? 'text-accent' : 'text-text-muted'}`}>
              {value.one_time_use ? 'On' : 'Off'}
            </span>
          </button>
        </div>

        {/* Max sessions */}
        <div>
          <label className={LABEL_CLS}>Max sessions</label>
          <input
            type="number"
            min={0}
            placeholder="--"
            value={value.max_sessions ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
              updateField('max_sessions', v);
            }}
            className="w-full"
            style={{ fontSize: '13px', fontFamily: 'var(--font-sans)' }}
          />
        </div>
      </div>
      )}

      {/* Advanced toggle (hidden when advancedOnly — parent controls visibility) */}
      {!advancedOnly && (
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2.5 w-full py-1 cursor-pointer group bg-transparent"
        >
          <svg
            className={`w-3 h-3 text-text-muted transition-transform duration-200 ${showAdvanced ? 'rotate-90' : ''}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
          </svg>
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider group-hover:text-text-secondary transition-colors">
            Advanced
          </span>
          <div className="flex-1 h-px bg-glass-border" />
        </button>
      )}

      {/* Advanced tier */}
      {(advancedOnly || showAdvanced) && (
        <div className={`flex flex-col ${compact ? 'gap-2.5' : 'gap-3'} p-3.5 bg-surface-1 rounded-xl border border-glass-border animate-in`}>
          {/* IP allowlist */}
          <div>
            <label className={LABEL_CLS}>Restrict by IP address</label>
            <input
              value={(policy.ip_allowlist || []).join(', ')}
              onChange={(e) => {
                const list = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                updatePolicy({ ip_allowlist: list.length > 0 ? list : undefined });
              }}
              placeholder="e.g., 192.168.1.0/24"
              className="w-full"
            />
            <span className="text-[10px] text-text-muted mt-1 block">Only these IP ranges can access</span>
          </div>

          {/* IP denylist */}
          <div>
            <label className={LABEL_CLS}>Block IP addresses</label>
            <input
              value={(policy.ip_denylist || []).join(', ')}
              onChange={(e) => {
                const list = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                updatePolicy({ ip_denylist: list.length > 0 ? list : undefined });
              }}
              placeholder="e.g., 10.0.0.0/8"
              className="w-full"
            />
            <span className="text-[10px] text-text-muted mt-1 block">These IP ranges will be denied access</span>
          </div>

          {/* Geo row — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Allow by country</label>
              <input
                value={(policy.geo_allowlist || []).join(', ')}
                onChange={(e) => {
                  const list = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  updatePolicy({ geo_allowlist: list.length > 0 ? list : undefined });
                }}
                placeholder="e.g., US, CA, GB"
                className="w-full"
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Block by country</label>
              <input
                value={(policy.geo_denylist || []).join(', ')}
                onChange={(e) => {
                  const list = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  updatePolicy({ geo_denylist: list.length > 0 ? list : undefined });
                }}
                placeholder="e.g., CN, RU"
                className="w-full"
              />
            </div>
          </div>

          {/* AI agent policy */}
          <div>
            <label className={LABEL_CLS}>AI bot protection</label>
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => {
                  const current = policy.ai_agent_policy?.block_all || false;
                  updatePolicy({
                    ai_agent_policy: {
                      ...policy.ai_agent_policy,
                      block_all: !current,
                    },
                  });
                }}
                className={`
                  relative w-10 h-[22px] rounded-full shrink-0 transition-colors duration-200
                  ${policy.ai_agent_policy?.block_all ? 'bg-danger' : 'bg-surface-3'}
                `}
              >
                <span
                  className={`
                    absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-200
                    ${policy.ai_agent_policy?.block_all ? 'left-[21px]' : 'left-[3px]'}
                  `}
                />
              </button>
              <span className="text-xs text-text-secondary">
                Block all AI bots &amp; scrapers
              </span>
            </div>
            {!policy.ai_agent_policy?.block_all && (
              <div className="flex flex-wrap gap-1.5">
                {AI_CATEGORIES.map((cat) => {
                  const denied = policy.ai_agent_policy?.deny_categories || [];
                  const active = denied.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        const newDenied = active
                          ? denied.filter((c) => c !== cat)
                          : [...denied, cat];
                        updatePolicy({
                          ai_agent_policy: {
                            ...policy.ai_agent_policy,
                            block_all: false,
                            deny_categories: newDenied.length > 0 ? newDenied : undefined,
                          },
                        });
                      }}
                      className={`
                        px-2.5 py-1 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-150
                        ${active
                          ? 'bg-danger-dim text-danger border border-danger-border'
                          : 'bg-surface-3 text-text-secondary border border-transparent hover:text-text-primary'
                        }
                      `}
                    >
                      {active ? '\u2715 ' : ''}
                      {AI_CATEGORY_LABELS[cat] || cat.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Session duration */}
          <div>
            <label className={LABEL_CLS}>Session duration</label>
            <select
              value={value.session_duration || ''}
              onChange={(e) => updateField('session_duration', e.target.value || undefined)}
            >
              <option value="">Default</option>
              {SESSION_DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-text-muted mt-1 block">How long each viewer can stay connected</span>
          </div>
        </div>
      )}
    </div>
  );
}
