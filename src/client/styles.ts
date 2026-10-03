export const styles = `
.dshysk-anchor {
  position: relative;
  height: 0;
  width: calc(100% - 24px);
  max-width: var(--dsh-composer-card-max-width, 712px);
  margin-inline: auto;
  z-index: 8;
  font: inherit;
  --dshysk-accent: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #5686fe);
  --dshysk-border: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 14%, transparent));
  --dshysk-surface: var(--dsw-alias-bg-layer-1, Canvas);
}
.dshysk-card, .dshysk-trigger {
  position: absolute;
  bottom: 12px;
  left: 0;
  box-sizing: border-box;
  background: var(--dshysk-surface);
  color: inherit;
  border: 1px solid var(--dshysk-border);
  box-shadow: 0 8px 28px rgb(0 0 0 / 16%);
}
.dshysk-card {
  width: min(560px, 100%);
  border-radius: 14px;
  padding: 14px 16px 12px;
  font-size: 14px;
  line-height: 1.65;
}
.dshysk-header, .dshysk-label, .dshysk-trigger, .dshysk-actions {
  display: flex;
  align-items: center;
}
.dshysk-header { justify-content: space-between; margin-bottom: 8px; }
.dshysk-label { gap: 8px; font-size: 12px; font-weight: 500; }
.dshysk-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dshysk-accent) 12%, transparent);
  color: var(--dshysk-accent);
  font: 600 12px Georgia, serif;
}
.dshysk-card button, .dshysk-trigger {
  appearance: none;
  font: inherit;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
  text-decoration: none;
}
.dshysk-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  opacity: .65;
}
.dshysk-content {
  max-height: min(42vh, 320px);
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.dshysk-card p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.dshysk-summary { font-weight: 500; }
.dshysk-explanation {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--dshysk-border);
  font-size: 13px;
}
.dshysk-explanation section + section { margin-top: 12px; }
.dshysk-explanation h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; }
.dshysk-explanation p + p, .dshysk-explanation pre { margin-top: 8px; }
.dshysk-explanation pre { overflow: auto; font-size: 12px; line-height: 1.5; }
.dshysk-actions { gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.dshysk-actions button {
  min-height: 30px;
  padding: 4px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
}
.dshysk-actions button.dshysk-primary {
  color: var(--dshysk-accent);
  background: color-mix(in srgb, var(--dshysk-accent) 10%, transparent);
  border-color: color-mix(in srgb, var(--dshysk-accent) 16%, transparent);
}
.dshysk-actions > span { width: 100%; font-size: 12px; opacity: .65; }
.dshysk-card button:hover, .dshysk-trigger:hover {
  background: var(--dsw-alias-interactive-bg-hover, color-mix(in srgb, currentColor 7%, transparent));
}
.dshysk-card button:focus-visible, .dshysk-trigger:focus-visible {
  outline: 2px solid var(--dshysk-accent);
  outline-offset: 2px;
}
.dshysk-card button:disabled { opacity: .5; cursor: wait; }
.dshysk-card .dshysk-status { margin-top: 10px; font-size: 12px; opacity: .7; }
.dshysk-trigger { gap: 8px; border-radius: 20px; padding: 7px 12px; line-height: 18px; }
.dshysk-settings {
  container: dshysk-settings / inline-size;
  width: 100%;
  max-width: 640px;
  box-sizing: border-box;
  font: inherit;
  font-size: 14px;
  line-height: 1.55;
  --dshysk-settings-accent: var(--dsw-alias-brand-primary-new-colorprimary-new-color, #5686fe);
  --dshysk-settings-border: var(--dsw-alias-border-l2, color-mix(in srgb, currentColor 14%, transparent));
  --dshysk-settings-muted: color-mix(in srgb, currentColor 65%, transparent);
  --dshysk-settings-control: color-mix(in srgb, currentColor 4%, transparent);
}
.dshysk-settings *, .dshysk-settings *::before { box-sizing: border-box; }
.dshysk-settings-header { padding: 20px 0 24px; }
.dshysk-settings h3 { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.4; letter-spacing: -.3px; }
.dshysk-settings p { margin: 0; }
.dshysk-settings-header p { margin-top: 8px; color: var(--dshysk-settings-muted); font-size: 13px; }
.dshysk-settings-rows { border-top: 1px solid var(--dshysk-settings-border); }
.dshysk-setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  align-items: center;
  gap: 24px;
  padding: 20px 0;
  border-bottom: 1px solid var(--dshysk-settings-border);
}
.dshysk-setting-toggle { grid-template-columns: minmax(0, 1fr) auto; cursor: pointer; }
.dshysk-setting-copy { display: grid; gap: 5px; min-width: 0; }
.dshysk-setting-title { font-size: 14px; font-weight: 500; }
.dshysk-setting-description { font-size: 12px; line-height: 1.6; color: var(--dshysk-settings-muted); }
.dshysk-settings .dshysk-switch {
  appearance: none;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  margin: 0;
  padding: 2px;
  border: 0;
  border-radius: 20px;
  background: color-mix(in srgb, currentColor 24%, transparent);
  cursor: pointer;
}
.dshysk-settings .dshysk-switch::before {
  content: '';
  display: block;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgb(0 0 0 / 15%);
}
.dshysk-settings .dshysk-switch:checked { background: var(--dshysk-settings-accent); }
.dshysk-settings .dshysk-switch:checked::before { transform: translateX(16px); }
.dshysk-select-wrap { position: relative; min-width: 0; }
.dshysk-settings select {
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 36px;
  padding: 0 32px 0 12px;
  border: 1px solid var(--dshysk-settings-border);
  border-radius: 8px;
  background: var(--dshysk-settings-control);
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-overflow: ellipsis;
  cursor: pointer;
}
.dshysk-select-chevron { position: absolute; right: 10px; top: 10px; width: 16px; height: 16px; pointer-events: none; opacity: .6; }
.dshysk-select-chevron path, .dshysk-refresh path { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.dshysk-model-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dshysk-model-controls .dshysk-select-wrap { flex: 1; }
.dshysk-settings .dshysk-refresh {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  appearance: none;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  margin: 0;
  padding: 0;
  border: 1px solid var(--dshysk-settings-border);
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.dshysk-refresh svg { width: 18px; height: 18px; }
.dshysk-settings select:hover, .dshysk-settings .dshysk-refresh:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
.dshysk-settings select:focus-visible, .dshysk-settings .dshysk-switch:focus-visible, .dshysk-settings .dshysk-refresh:focus-visible {
  outline: 2px solid var(--dshysk-settings-accent);
  outline-offset: 3px;
}
.dshysk-settings select:disabled, .dshysk-settings .dshysk-switch:disabled, .dshysk-settings .dshysk-refresh:disabled { opacity: .5; cursor: wait; }
.dshysk-settings-footer { display: grid; gap: 12px; padding-top: 20px; }
.dshysk-settings-usage { font-size: 12px; line-height: 1.7; color: var(--dshysk-settings-muted); }
.dshysk-settings-status { min-height: 20px; font-size: 12px; color: var(--dshysk-settings-muted); }
.dshysk-settings-message { margin: 20px 0; font: inherit; font-size: 13px; }
@container dshysk-settings (max-width: 480px) {
  .dshysk-setting-row { grid-template-columns: minmax(0, 1fr); gap: 12px; padding: 18px 0; }
  .dshysk-setting-toggle { grid-template-columns: minmax(0, 1fr) auto; gap: 20px; }
}
`
