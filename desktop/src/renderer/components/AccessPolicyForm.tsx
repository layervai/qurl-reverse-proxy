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
    <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'}`}>
      {/* Simple tier: expiry, one-time, max sessions (hidden when advancedOnly) */}
      {!advancedOnly && (
      <div className="flex gap-3 items-end flex-wrap">
        {/* Expiry */}
        <div className={compact ? 'flex-[1_1_120px]' : 'flex-none'}>
          <label className="text-xs font-medium text-text-secondary mb-1 block">Expiry</label>
          <select
            value={value.expires_in || '1h'}
            onChange={(e) => updateField('expires_in', e.target.value)}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* One-time-use toggle */}
        <div className="flex items-center gap-2 pb-0.5">
          <button
            type="button"
            onClick={() => updateField('one_time_use', !value.one_time_use)}
            className={`
              relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200
              ${value.one_time_use ? 'bg-accent' : 'bg-surface-3'}
            `}
          >
            <span
              className={`
                absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-200
                ${value.one_time_use ? 'left-[18px]' : 'left-0.5'}
              `}
            />
          </button>
          <span className="text-xs text-text-secondary">One-time use</span>
        </div>

        {/* Max sessions */}
        <div className={compact ? 'flex-[1_1_100px]' : 'flex-none'}>
          <label className="text-xs font-medium text-text-secondary mb-1 block">Max sessions</label>
          <input
            type="number"
            min={0}
            placeholder="--"
            value={value.max_sessions ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
              updateField('max_sessions', v);
            }}
            className={compact ? 'w-full' : 'w-20'}
          />
        </div>
      </div>
      )}

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="self-start bg-transparent text-accent text-xs font-medium py-1 cursor-pointer flex items-center gap-1"
      >
        <span
          className={`
            inline-block text-[10px] transition-transform duration-150
            ${showAdvanced ? 'rotate-90' : 'rotate-0'}
          `}
        >
          {'\u25B6'}
        </span>
        Advanced Settings
      </button>

      {/* Advanced tier */}
      {showAdvanced && (
        <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-3'} p-3 bg-surface-1 rounded-md border border-glass-border`}>
          {/* IP allowlist */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">IP Allowlist</label>
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
          </div>

          {/* IP denylist */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">IP Denylist</label>
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
          </div>

          {/* Geo allowlist */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Geo Allowlist</label>
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

          {/* Geo denylist */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Geo Denylist</label>
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

          {/* AI agent policy */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">AI Agent Policy</label>
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
                  relative w-9 h-5 rounded-full shrink-0 transition-colors duration-200
                  ${policy.ai_agent_policy?.block_all ? 'bg-danger' : 'bg-surface-3'}
                `}
              >
                <span
                  className={`
                    absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-[left] duration-200
                    ${policy.ai_agent_policy?.block_all ? 'left-[18px]' : 'left-0.5'}
                  `}
                />
              </button>
              <span className="text-xs text-text-secondary">
                Block all AI agents
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
                        px-2.5 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-all duration-150
                        ${active
                          ? 'bg-danger-dim text-danger border border-danger-border'
                          : 'bg-surface-3 text-text-secondary border border-transparent hover:text-text-primary'
                        }
                      `}
                    >
                      {active ? '\u2715 ' : ''}
                      {cat.replace(/_/g, ' ')}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Session duration */}
          <div>
            <label className="text-xs font-medium text-text-secondary mb-1 block">Session Duration</label>
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
          </div>
        </div>
      )}
    </div>
  );
}
