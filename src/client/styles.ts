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
.dshysk-settings { display: grid; gap: 14px; }
.dshysk-settings label { display: flex; gap: 10px; align-items: center; }
.dshysk-settings select { font: inherit; max-width: 100%; }
`
