import type { SeasonOrnamentId } from '@lucy-spa/contracts';
import { buttonClass } from './button';
import { cx } from './cx';
import { GreetingStrip, SeasonFrame } from './season-frame';
import { SeasonOrnament } from './season-ornaments';

// Admin preview of a season (docs/UXUI_REDESIGN_DESIGN.md 20.7): the real banner frame and greeting strip, scoped to
// one preset, in a desktop-width and a phone-width frame, each in light and in dark. `data-season` scopes the preset
// to the frame and `data-preview-theme` forces the theme there (tokens.css, season.css), so the four pictures do not
// depend on the page theme. Pictures, not controls: nothing inside takes focus, and no public URL shows them.

export interface SeasonPreviewLabels {
  desktop: string;
  phone: string;
  light: string;
  dark: string;
  /** Names the frame for assistive technology, for example "Phone, dark". */
  frame: (device: string, theme: string) => string;
  /** The sample of the accent colour (a chip) and of the unchanged brand button. */
  accentSample: string;
  buttonSample: string;
}

export interface SeasonPresetChoice {
  key: string;
  name: string;
  ornamentId: SeasonOrnamentId;
}

/**
 * The preset picker (docs/UXUI_REDESIGN_DESIGN.md 20.7): one card per preset with a swatch (the preset's own banner
 * colours and ornament) and its name. Native radio buttons, so the arrow keys, the group label and the checked
 * state come from the browser; the card is the label, so the whole card is the touch target.
 */
export function SeasonPresetPicker({
  name,
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  /** The radio group's name (unique on the page). */
  name: string;
  label: string;
  options: readonly SeasonPresetChoice[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="ls-season-picker" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.key} className="ls-season-card" data-season={option.key}>
          <input
            className="ls-season-card-input"
            type="radio"
            name={name}
            value={option.key}
            checked={option.key === value}
            disabled={disabled}
            onChange={() => onChange(option.key)}
          />
          <span className="ls-season-card-swatch" aria-hidden="true">
            <SeasonOrnament id={option.ornamentId} className="ls-season-card-orn" />
          </span>
          <span className="ls-season-card-name">{option.name}</span>
        </label>
      ))}
    </div>
  );
}

const DEVICES = ['desktop', 'phone'] as const;
const THEMES = ['light', 'dark'] as const;

export function SeasonPreview({
  presetKey,
  ornamentId,
  title,
  greeting,
  labels,
}: {
  presetKey: string;
  ornamentId: SeasonOrnamentId;
  /** The banner heading (the brand name). */
  title: string;
  greeting: string;
  labels: SeasonPreviewLabels;
}) {
  return (
    <div className="ls-season-previews">
      {THEMES.flatMap((theme) =>
        DEVICES.map((device) => {
          const caption = labels.frame(labels[device], labels[theme]);
          return (
            <figure
              key={`${theme}-${device}`}
              className={cx('ls-season-pframe', `ls-season-pframe-${device}`)}
            >
              <figcaption className="ls-season-pcaption">{caption}</figcaption>
              <div className="ls-season-pstage" data-season={presetKey} data-preview-theme={theme}>
                <SeasonFrame ornamentId={ornamentId}>
                  <p className="ls-season-ptitle">{title}</p>
                  <p className="ls-season-greeting">{greeting}</p>
                </SeasonFrame>
                <div className="ls-season-pbody">
                  <span className="ls-season-pchip">{labels.accentSample}</span>
                  <span className={buttonClass('primary', 'md')}>{labels.buttonSample}</span>
                </div>
                <GreetingStrip ornamentId={ornamentId} greeting={greeting} />
              </div>
            </figure>
          );
        }),
      )}
    </div>
  );
}
