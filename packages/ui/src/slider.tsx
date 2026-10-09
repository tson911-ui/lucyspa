'use client';

import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { IconButton } from './button';
import { buttonClass } from './button-class';
import { cx } from './cx';
import { fillTemplate } from './paging-core';
import type { PromoImage, PromoLink } from './promo';
import { isAutoplaying, SLIDER_AUTOPLAY_MS, stepIndex, swipeDelta } from './slider-core';
import { useMediaQuery } from './use-media-query';

// The homepage slider (docs/UXUI_REDESIGN_DESIGN.md 16.6): a basic, non-cinematic carousel. Previous/next,
// dots, swipe, autoplay that pauses on hover, focus and touch and has a visible Pause button, and no
// autoplay at all under `prefers-reduced-motion`. The picture keeps a fixed aspect ratio so nothing shifts
// while images load; the first image is eager and the rest lazy. A single slide shows no controls.

export interface SliderSlide {
  id: string;
  title: string | null;
  subtitle: string | null;
  /** The desktop image; its `alt` is the description every screen reader hears for this slide. */
  image: PromoImage;
  /** The phone image; without it the desktop image is cropped to fit. */
  mobileImage: PromoImage | null;
  cta: { label: string; href: string } | null;
}

export interface SliderLabels {
  /** Accessible name of the whole slider, e.g. "Featured offers". */
  region: string;
  previous: string;
  next: string;
  pause: string;
  play: string;
  /** "Slide {position} of {count}" */
  slide: string;
  /** "Go to slide {position}" */
  goTo: string;
}

/** The phone breakpoint of the design (section 13); the `<picture>` source switches here. */
const PHONE_MEDIA = '(max-width: 639px)';

export function Slider({
  slides,
  labels,
  autoplayMs = SLIDER_AUTOPLAY_MS,
  LinkComponent,
  className,
}: {
  slides: readonly SliderSlide[];
  labels: SliderLabels;
  autoplayMs?: number | undefined;
  LinkComponent?: PromoLink | undefined;
  className?: string | undefined;
}) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const current = Math.min(index, Math.max(count - 1, 0));

  const running = isAutoplaying({ count, reducedMotion, userPaused, hovering, focused, touching });
  useEffect(() => {
    if (!running) return;
    // Re-armed on every change of slide, so a manual move gets a full interval before the next one.
    const timer = window.setTimeout(() => setIndex((at) => stepIndex(at, count, 1)), autoplayMs);
    return () => window.clearTimeout(timer);
  }, [running, current, count, autoplayMs]);

  if (count === 0) return null;
  const many = count > 1;
  const hasPhoneImage = slides.some((slide) => slide.mobileImage !== null);
  const go = (delta: number) => setIndex(stepIndex(current, count, delta));

  function onTouchEnd(event: TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    setTouching(false);
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const delta = swipeDelta(touch.clientX - start.x, touch.clientY - start.y);
    if (delta !== 0) go(delta);
  }

  const Link = LinkComponent;
  const ctaClass = buttonClass('primary', 'md');
  return (
    <section
      className={cx('ls-slider', hasPhoneImage && 'ls-slider-tall', className)}
      aria-roledescription="carousel"
      aria-label={labels.region}
      // Only a mouse hovers: a tap on a phone also fires the emulated `mouseenter`, which left the slider paused for good.
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') setHovering(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') setHovering(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        className="ls-slider-viewport"
        // While it moves by itself nothing is announced; once the visitor is in control, each change is.
        aria-live={running ? 'off' : 'polite'}
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (!touch || !many) return;
          touchStart.current = { x: touch.clientX, y: touch.clientY };
          setTouching(true);
        }}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => {
          touchStart.current = null;
          setTouching(false);
        }}
      >
        <div className="ls-slider-track" style={{ transform: `translateX(-${current * 100}%)` }}>
          {slides.map((slide, position) => {
            const active = position === current;
            const { image, mobileImage, cta } = slide;
            return (
              <div
                key={slide.id}
                className="ls-slider-slide"
                role="group"
                aria-roledescription="slide"
                aria-label={fillTemplate(labels.slide, { position: position + 1, count })}
                aria-hidden={active ? undefined : true}
                // Not focusable and not read while off screen.
                inert={active ? undefined : true}
              >
                <picture className="ls-slider-media">
                  {mobileImage ? (
                    <source
                      media={PHONE_MEDIA}
                      srcSet={mobileImage.srcSet ?? mobileImage.src}
                      sizes={mobileImage.sizes ?? '100vw'}
                      width={mobileImage.width}
                      height={mobileImage.height}
                    />
                  ) : null}
                  <img
                    src={image.src}
                    srcSet={image.srcSet}
                    sizes={image.sizes ?? '100vw'}
                    alt={image.alt}
                    width={image.width}
                    height={image.height}
                    loading={position === 0 ? 'eager' : 'lazy'}
                    {...(position === 0 ? { fetchPriority: 'high' as const } : {})}
                    decoding="async"
                  />
                </picture>
                {slide.title || slide.subtitle || cta ? (
                  <div className="ls-slider-caption">
                    {slide.title ? <h2 className="ls-slider-title">{slide.title}</h2> : null}
                    {slide.subtitle ? <p className="ls-slider-text">{slide.subtitle}</p> : null}
                    {cta ? (
                      Link ? (
                        <Link href={cta.href} className={ctaClass}>
                          {cta.label}
                        </Link>
                      ) : (
                        <a href={cta.href} className={ctaClass}>
                          {cta.label}
                        </a>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {many ? (
        <div className="ls-slider-controls">
          <IconButton icon="chevron-left" label={labels.previous} onClick={() => go(-1)} />
          <div className="ls-slider-dots">
            {slides.map((slide, position) => (
              <button
                key={slide.id}
                type="button"
                className="ls-slider-dot"
                aria-label={fillTemplate(labels.goTo, { position: position + 1 })}
                aria-current={position === current ? 'true' : undefined}
                onClick={() => setIndex(position)}
              />
            ))}
          </div>
          <IconButton icon="chevron-right" label={labels.next} onClick={() => go(1)} />
          {reducedMotion ? null : (
            <IconButton
              icon={userPaused ? 'play' : 'pause'}
              label={userPaused ? labels.play : labels.pause}
              onClick={() => setUserPaused(!userPaused)}
            />
          )}
        </div>
      ) : null}
    </section>
  );
}
