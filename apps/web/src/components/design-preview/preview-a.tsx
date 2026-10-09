import Link from 'next/link';
import { editorialDisplay, editorialText } from './fonts';
import { PhotoSlot } from './placeholder';
import type { PreviewModel } from './preview-model';
import { splitTagline } from './tagline';
import './preview-a.css';

/**
 * Direction A, "Biên tập": an editorial, luxurious page. A very large garamond headline, a tall arched photo, hairlines instead of
 * boxes, and the price list drawn as a menu card. The memorable thing is the menu; everything else stays quiet.
 */
export function PreviewA({ model }: { model: PreviewModel }) {
  const [first, second] = splitTagline(model.tagline);
  const vi = model.locale === 'vi';
  return (
    <div className={`dp dpa ${editorialDisplay.variable} ${editorialText.variable}`}>
      <header className="dpa-header">
        <Link className="dpa-logo" href={model.links.home}>
          LUCY SPA
        </Link>
        <nav className="dpa-nav" aria-label={vi ? 'Điều hướng' : 'Navigation'}>
          <Link href={model.links.services}>{model.words.services}</Link>
          <Link href={model.links.products}>{model.words.products}</Link>
        </nav>
        <Link className="dpa-btn dpa-btn-line" href={model.links.book}>
          {model.words.book}
        </Link>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="dpa-hero" aria-labelledby="dpa-title">
          <div className="dpa-hero-copy">
            <h1 id="dpa-title" className="dpa-title">
              <span>{first}</span>
              {second ? <span className="dpa-title-2">{second}</span> : null}
            </h1>
            <p className="dpa-lead">{model.intro}</p>
            <div className="dpa-actions">
              <Link className="dpa-btn dpa-btn-solid" href={model.links.book}>
                {model.words.book}
              </Link>
              <Link className="dpa-link" href="#bang-gia">
                {model.words.viewServices}
              </Link>
            </div>
          </div>
          <PhotoSlot
            className="dpa-arch"
            image={model.heroImage}
            caption={
              vi
                ? 'Ảnh của tiệm: phòng thư giãn, ánh sáng ấm'
                : 'The shop’s own photo: the relaxation room'
            }
          />
        </section>

        <section className="dpa-facts" aria-label={vi ? 'Thông tin nhanh' : 'At a glance'}>
          {model.hours ? (
            <p className="dpa-fact">
              <span className="dpa-fact-label">{vi ? 'Giờ mở cửa' : 'Opening hours'}</span>
              <strong>{model.hours.value}</strong>
              <span className="dpa-fact-sub">{model.hours.label}</span>
            </p>
          ) : null}
          {model.address ? (
            <p className="dpa-fact">
              <span className="dpa-fact-label">{vi ? 'Địa chỉ' : 'Address'}</span>
              <strong>{model.address}</strong>
              {model.directions ? (
                <a
                  className="dpa-fact-sub"
                  href={model.directions}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {vi ? 'Chỉ đường' : 'Directions'}
                </a>
              ) : null}
            </p>
          ) : null}
          {model.hotline ? (
            <p className="dpa-fact">
              <span className="dpa-fact-label">{model.words.hotline}</span>
              <strong>{model.hotline}</strong>
              {model.tel ? (
                <a className="dpa-fact-sub" href={model.tel}>
                  {vi ? 'Gọi ngay' : 'Call now'}
                </a>
              ) : null}
            </p>
          ) : null}
        </section>

        <section className="dpa-menu" id="bang-gia" aria-labelledby="dpa-menu-title">
          <div className="dpa-menu-head">
            <h2 id="dpa-menu-title" className="dpa-h2">
              {model.words.groupsTitle}
            </h2>
            <p>{model.words.groupsLead}</p>
            <Link className="dpa-link" href={model.links.services}>
              {vi ? 'Xem mọi dịch vụ' : 'See every service'}
            </Link>
          </div>
          <div className="dpa-menu-body">
            {model.groups.map((group) => (
              <section
                className="dpa-group"
                key={group.code}
                aria-labelledby={`dpa-g-${group.code}`}
              >
                <header className="dpa-group-head">
                  <h3 id={`dpa-g-${group.code}`}>{group.name}</h3>
                  <p>
                    {group.count} {vi ? 'dịch vụ' : 'services'}
                    {group.from ? `, ${group.from}` : ''}
                  </p>
                </header>
                {group.description ? <p className="dpa-group-note">{group.description}</p> : null}
                <ul className="dpa-rows">
                  {group.services.map((service) => (
                    <li key={service.code}>
                      <Link className="dpa-row" href={service.href}>
                        <span className="dpa-row-name">{service.name}</span>
                        <span className="dpa-row-dots" aria-hidden="true" />
                        <span className="dpa-row-price">{service.price}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>

        <section className="dpa-gallery" aria-label={vi ? 'Không gian của tiệm' : 'The shop'}>
          <PhotoSlot
            className="dpa-g1"
            caption={
              vi
                ? 'Ảnh của tiệm: gội đầu dưỡng sinh, cận cảnh'
                : 'The shop’s own photo: head spa, close up'
            }
          />
          <PhotoSlot
            className="dpa-g2"
            caption={vi ? 'Ảnh của tiệm: làm nail, đôi tay' : 'The shop’s own photo: nails, hands'}
          />
          <PhotoSlot
            className="dpa-g3"
            caption={vi ? 'Ảnh của tiệm: chăm sóc da mặt' : 'The shop’s own photo: facial care'}
          />
        </section>

        {model.campaign ? (
          <section className="dpa-offer" aria-label={model.campaign.name}>
            <h2 className="dpa-offer-title">{model.campaign.name}</h2>
            <p>{model.campaign.message}</p>
            <Link className="dpa-btn dpa-btn-light" href={model.campaign.href}>
              {model.campaign.cta}
            </Link>
          </section>
        ) : null}
      </main>

      <footer className="dpa-footer">
        <p className="dpa-wordmark" aria-hidden="true">
          LUCY SPA
        </p>
        <p className="dpa-footnote">
          {model.address ? <span>{model.address}</span> : null}
          {model.hotline ? <span>{model.hotline}</span> : null}
        </p>
      </footer>
    </div>
  );
}
