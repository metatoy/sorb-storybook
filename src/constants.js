// Stable addon + surface ids. Storybook keys panels, params, and channel events
// off these — they MUST stay constant across versions or saved panel state and
// deep-links break.

/** The addon namespace. */
export const ADDON_ID = 'sorb/storybook'

/** The per-story Bound Tokens manager panel. */
export const PANEL_ID = `${ADDON_ID}/panel`

/** The Token Explorer tab (full resolved-map listing + reverse "used by"). */
export const TAB_ID = `${ADDON_ID}/explorer`

/** Story parameter key the preset stamps the joined token data onto. */
export const PARAM_KEY = 'sorb';
