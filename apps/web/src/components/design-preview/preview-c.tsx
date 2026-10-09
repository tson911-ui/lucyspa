import { Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import { warmDisplay, warmText } from './fonts';
import { PhotoSlot } from './placeholder';
import type { PreviewModel } from './preview-model';
import { splitTagline } from './tagline';
import './preview-c.css';

/** A soft wave between two bands, drawn in the colour of the band that follows. */
function Wave({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      className={`dpc-wave${flip ? ' dpc-wave-flip' : ''}`}
      viewBox="0 0 1440 90"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 52C180 12 330 8 520 36s330 52 520 22 290-44 400-26v58H0z" fill="currentColor" />
    </svg>
  );
}

/**
 * Direction C, "Ấm áp thư giãn": a warm, rounded, calm wellness page. A soft serif, pebble-shaped cards, circles of photos and a slow
 * breathing ring behind the hero (still under reduced motion). The memorable thing is the breathing circle of photos.
 */
export function PreviewC({ model }: { model: PreviewModel }) {
  const [first, second] = splitTagline(model.tagline);
  const vi = model.locale === 'vi';
  const tones = ['rose', 'sage', 'blush', 'cream'] as const;
  return (
    <div className={`dp dpc ${warmDisplay.variable} ${warmText.variable}`}>
      <header className="dpc-header">
        <Link className="dpc-logo" href={model.links.home}>
          LUCY SPA
        </Link>
        <nav className="dpc-nav" aria-label={vi ? 'Điều hướng' : 'Navigation'}>
          <Link href={model.links.services}>{model.words.services}</Link>
          <Link href={model.links.products}>{model.words.products}</Link>
        </nav>
        <Link className="dpc-btn dpc-btn-solid" href={model.links.book}>
          {model.words.book}
        </Link>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="dpc-hero" aria-labelledby="dpc-title">
          <div className="dpc-hero-copy">
            <h1 id="dpc-title" className="dpc-title dp-rise">
              <span>{first}</span>
              {second ? <span className="dpc-title-2">{second}</span> : null}
            </h1>
            <p className="dpc-lead dp-rise">{model.intro}</p>
            <div className="dpc-actions dp-rise">
              <Link className="dpc-btn dpc-btn-solid dpc-btn-lg" href={model.links.book}>
                {model.words.book}
              </Link>
              <Link className="dpc-btn dpc-btn-soft dpc-btn-lg" href="#dich-vu">
                {model.words.viewServices}
              </Link>
            </div>
          </div>
          <div className="dpc-circles" aria-hidden={model.heroImage ? undefined : true}>
            <span className="dpc-ring" aria-hidden="true" />
            <PhotoSlot
              className="dpc-big"
              image={model.heroImage}
              caption={
                vi
                  ? 'Ảnh của tiệm: không gian thư giãn'
                  : 'The shop’s own photo: the relaxation space'
              }
            />
            <PhotoSlot
              className="dpc-small"
              caption={vi ? 'Ảnh của tiệm: bàn tay làm nail' : 'The shop’s own photo: nails'}
            />
            <PhotoSlot
              className="dpc-pill"
              caption={vi ? 'Ảnh của tiệm: gội đầu' : 'The shop’s own photo: head spa'}
            />
          </div>
        </section>

        <section className="dpc-facts" aria-label={vi ? 'Thông tin nhanh' : 'At a glance'}>
          {model.hours ? (
            <p className="dpc-chip">
              <Icon name="clock" size={20} />
              <span>
                <strong>{model.hours.value}</strong> {model.hours.label}
              </span>
            </p>
          ) : null}
          {model.address ? (
            <a
              className="dpc-chip"
              href={model.directions ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="map-pin" size={20} />
              <span>
                <strong>{model.address}</strong>
              </span>
            </a>
          ) : null}
          {model.hotline && model.tel ? (
            <a className="dpc-chip" href={model.tel}>
              <Icon name="phone" size={20} />
              <span>
                <strong>{model.hotline}</strong>
              </span>
            </a>
          ) : null}
        </section>

        <div className="dpc-band-rose">
          <Wave />
          <section className="dpc-services" id="dich-vu" aria-labelledby="dpc-services-title">
            <div className="dpc-head">
              <h2 id="dpc-services-title" className="dpc-h2">
                {model.words.groupsTitle}
              </h2>
              <p>{model.words.groupsLead}</p>
            </div>
            <div className="dpc-pebbles">
              {model.groups.map((group, index) => (
                <article
                  className={`dpc-pebble dpc-${tones[index % tones.length]}`}
                  key={group.code}
                >
                  <header>
                    <h3>{group.name}</h3>
                    <p>
                      {group.count} {vi ? 'dịch vụ' : 'services'}
                      {group.from ? `, ${group.from}` : ''}
                    </p>
                  </header>
                  <ul>
                    {group.services.slice(0, 3).map((service) => (
                      <li key={service.code}>
                        <Link href={service.href}>
                          <span>{service.name}</span>
                          <span className="dpc-price">{service.price}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        </div>

        {model.campaign ? (
          <section className="dpc-offer-wrap" aria-label={model.campaign.name}>
            <div className="dpc-offer">
              {model.campaign.badge ? (
                <span className="dpc-badge">{model.campaign.badge}</span>
              ) : null}
              <h2 className="dpc-offer-title">{model.campaign.name}</h2>
              <p>{model.campaign.message}</p>
              <Link className="dpc-btn dpc-btn-white dpc-btn-lg" href={model.campaign.href}>
                {model.campaign.cta}
              </Link>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="dpc-footer">
        <Wave />
        <div className="dpc-footer-body">
          <p className="dpc-footer-logo">LUCY SPA</p>
          <p className="dpc-footer-line">
            {model.address ? <span>{model.address}</span> : null}
            {model.hotline ? <span>{model.hotline}</span> : null}
          </p>
        </div>
      </footer>
    </div>
  );
}
