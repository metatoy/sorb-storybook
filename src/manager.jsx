// Manager-side UI: registers the Sorb "Bound Tokens" panel + the Token Explorer
// tab. Thin render — all join/filter/index logic lives in `src/data/` (unit-
// tested). Targets Storybook 7 AND 8 (the `addons.register` + `addons.add`
// manager-api is stable across both majors).

import React, { useState, useMemo, useEffect } from 'react'
import { addons, types, useChannel, useStorybookState } from '@storybook/manager-api'
import { AddonPanel } from '@storybook/components'
import { ADDON_ID, PANEL_ID, TAB_ID, PARAM_KEY } from './constants.js'
import { filterResolved, usedBy } from './data/explorer.js'

/**
 * The per-story Bound Tokens panel. Reads the joined rows the preset stamped
 * onto the story's `parameters.sorb.boundRows` (or receives them over the
 * channel). Render is intentionally minimal.
 *
 * @param {{ active?: boolean, rows?: import('./data/boundTokens.js').BoundRow[] }} props
 */
function BoundTokensPanel({ active, rows = [] }) {
  if (!active) return null
  if (!rows.length) {
    return (
      <div style={S.empty}>
        No captured tokens for this story. Run <code>sorb capture</code> to
        populate <code>.sorb/</code>, then reload.
      </div>
    )
  }
  return (
    <table style={S.table}>
      <thead>
        <tr>
          <Th>role</Th>
          <Th>token id</Th>
          <Th>cssVar</Th>
          <Th>value</Th>
          <Th>tier</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <BoundRow key={`${r.tokenId}:${r.role}:${i}`} row={r} />
        ))}
      </tbody>
    </table>
  )
}

/** @param {{ row: import('./data/boundTokens.js').BoundRow }} props */
function BoundRow({ row }) {
  const [showCandidates, setShowCandidates] = useState(false)
  const isColor = row.type === 'color'
  return (
    <>
      <tr style={row.resolved ? undefined : S.stale}>
        <Td>{row.role}</Td>
        <Td>
          <code>{row.tokenId}</code>
          {row.candidates && row.candidates.length > 0 && (
            <button
              type="button"
              style={S.toggle}
              onClick={() => setShowCandidates((v) => !v)}
              aria-expanded={showCandidates}
            >
              {showCandidates ? 'hide' : `+${row.candidates.length}`} candidates
            </button>
          )}
        </Td>
        <Td>
          <code>{row.cssVar || '—'}</code>
        </Td>
        <Td>
          <span style={S.valueCell}>
            {isColor && row.value && (
              <span style={{ ...S.swatch, background: String(row.value) }} aria-hidden="true" />
            )}
            {row.value == null ? '—' : String(row.value)}
            {/* Live value badge slot — populated in-iframe via useToken (preview side). */}
            <span data-sorb-live-badge={row.cssVar || ''} style={S.liveBadge} />
          </span>
        </Td>
        <Td>{row.tier || '—'}</Td>
      </tr>
      {showCandidates && row.candidates && (
        <tr>
          <Td colSpan={5} style={S.candidates}>
            candidates: {row.candidates.map((c) => <code key={c} style={S.cand}>{c}</code>)}
          </Td>
        </tr>
      )}
    </>
  )
}

/**
 * The Token Explorer tab: full resolved-map listing with tier/type/q filters +
 * a reverse "used by" link per token.
 *
 * @param {{ active?: boolean, resolved?: import('@sorb/core').ResolvedToken[], reverseIndex?: Record<string,string[]> }} props
 */
function TokenExplorer({ active, resolved = [], reverseIndex = {} }) {
  const [q, setQ] = useState('')
  const [tier, setTier] = useState('')
  const [type, setType] = useState('')
  const reverseMap = useMemo(() => new Map(Object.entries(reverseIndex)), [reverseIndex])
  const rows = useMemo(
    () => filterResolved(resolved, { tier, type, q }),
    [resolved, tier, type, q],
  )
  if (!active) return null
  return (
    <div style={S.explorer}>
      <div style={S.filters}>
        <input
          placeholder="filter id / cssVar / value…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={S.input}
        />
        <select value={tier} onChange={(e) => setTier(e.target.value)} style={S.select}>
          <option value="">all tiers</option>
          <option value="component">component</option>
          <option value="semantic">semantic</option>
          <option value="primitive">primitive</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} style={S.select}>
          <option value="">all types</option>
          <option value="color">color</option>
          <option value="dimension">dimension</option>
        </select>
        <span style={S.count}>{rows.length} tokens</span>
      </div>
      <table style={S.table}>
        <thead>
          <tr>
            <Th>token id</Th>
            <Th>cssVar</Th>
            <Th>value</Th>
            <Th>tier</Th>
            <Th>used by</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const users = usedBy(t.id, reverseMap)
            return (
              <tr key={t.id}>
                <Td><code>{t.id}</code></Td>
                <Td><code>{t.cssVar}</code></Td>
                <Td>
                  <span style={S.valueCell}>
                    {t.type === 'color' && (
                      <span style={{ ...S.swatch, background: String(t.value) }} aria-hidden="true" />
                    )}
                    {String(t.value)}
                  </span>
                </Td>
                <Td>{t.tier}</Td>
                <Td>
                  {users.length === 0 ? (
                    <span style={S.muted}>—</span>
                  ) : (
                    users.map((s) => <code key={s} style={S.cand}>{s}</code>)
                  )}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Bridge between the preview-injected story params and the panel. Pulls the
 * joined rows + resolved bundle out of the active story's parameters.
 */
function PanelContainer({ active }) {
  const [bundle, setBundle] = useState({ rows: [] })
  // Preview-side broadcasts the active story's joined data over the channel.
  const emit = useChannel({
    [`${ADDON_ID}/data`]: (payload) => setBundle(payload || { rows: [] }),
  })
  // Ask the preview for data on mount, so a panel opened after the story already
  // rendered still fills (the render-time broadcast may have preceded us).
  useEffect(() => { emit(`${ADDON_ID}/request`) }, [])
  return <BoundTokensPanel active={active} rows={bundle.rows || []} />
}

function ExplorerContainer({ active }) {
  const [bundle, setBundle] = useState({ resolved: [], reverseIndex: {} })
  const emit = useChannel({
    [`${ADDON_ID}/explorer`]: (payload) => setBundle(payload || { resolved: [], reverseIndex: {} }),
  })
  // The Explorer TAB only mounts when activated — after story render — so it
  // misses the render-time broadcast. Request the bundle on mount.
  useEffect(() => { emit(`${ADDON_ID}/request`) }, [])
  return (
    <TokenExplorer
      active={active}
      resolved={bundle.resolved || []}
      reverseIndex={bundle.reverseIndex || {}}
    />
  )
}

// ─── Registration (SB 7 + 8) ────────────────────────────────────────────────
addons.register(ADDON_ID, () => {
  addons.add(PANEL_ID, {
    type: types.PANEL,
    title: 'Sorb',
    match: ({ viewMode }) => viewMode === 'story',
    render: ({ active }) => (
      <AddonPanel active={!!active}>
        <PanelContainer active={!!active} />
      </AddonPanel>
    ),
  })

  addons.add(TAB_ID, {
    type: types.TAB,
    title: 'Token Explorer',
    route: ({ storyId }) => `/sorb-explorer/${storyId}`,
    match: ({ viewMode }) => viewMode === 'sorb-explorer',
    render: ({ active }) => <ExplorerContainer active={!!active} />,
  })
})

// Lightweight inline styles (no CSS dep; SB themes its own chrome).
const S = {
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'monospace' },
  empty: { padding: 16, color: '#666', fontSize: 13 },
  stale: { opacity: 0.55 },
  valueCell: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 2, border: '1px solid rgba(0,0,0,.2)', display: 'inline-block' },
  liveBadge: {},
  toggle: { marginLeft: 6, fontSize: 10, cursor: 'pointer', border: '1px solid #ccc', borderRadius: 3, background: 'transparent' },
  candidates: { fontSize: 11, color: '#555', paddingLeft: 16 },
  cand: { marginRight: 6, padding: '0 4px', background: 'rgba(242,103,34,.12)', borderRadius: 3 },
  explorer: { padding: 12 },
  filters: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 },
  input: { flex: 1, padding: '4px 8px', fontSize: 12 },
  select: { padding: '4px 6px', fontSize: 12 },
  count: { fontSize: 11, color: '#888' },
  muted: { color: '#aaa' },
}

function Th({ children }) {
  return <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '4px 8px', fontWeight: 600 }}>{children}</th>
}
function Td({ children, colSpan, style }) {
  return <td colSpan={colSpan} style={{ borderBottom: '1px solid #f0f0f0', padding: '4px 8px', verticalAlign: 'top', ...style }}>{children}</td>
}

export { BoundTokensPanel, TokenExplorer, PARAM_KEY }
