import { Icon } from '@lucy-spa/ui';
import Link from 'next/link';
import { minimalAccent, minimalSans } from './fonts';
import { PhotoSlot } from './placeholder';
import type { PreviewModel } from './preview-model';
import { splitTagline } from './tagline';
import './preview-b.css';

const GROUP_ICON: Record<string, 'droplet' | 'sparkles' | 'gem' | 'leaf' | 'flower'> = {
  GOI_DAU: 'droplet',
  CHAM_SOC_DA_MAT: 'sparkles',
  NAIL: 'gem',
  MASSAGE: 'leaf',
};

/**
 * Direction B, "Tối giản hiện đại": white space, one confident sans, a floating translucent header and a bento grid of large soft
 * tiles. The memorable thing is the bento that answers the three questions of a visitor (when, where, how to book) next to a photo.
 */
export function PreviewB({ model }: { model: PreviewModel }) {
  const [first, second] = splitTagline(model.tagline);
  const vi = model.locale === 'vi';
  return (
    <div className={`dp dpb ${minimalSans.variable} ${minimalAccent.variable}`}>
      <header className="dpb-header-wrap">
        <div className="dpb-header">
          <Link className="dpb-logo" href={model.links.home}>
            LUCY SPA
          </Link>
          <nav className="dpb-nav" aria-label={vi ? 'Điều hướng' : 'Navigation'}>
            <Link href={model.links.services}>{model.words.services}</Link>
            <Link href={model.links.products}>{model.words.products}</Link>
          </nav>
          <Link className="dpb-btn dpb-btn-solid" href={model.links.book}>
            {model.words.book}
          </Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="dpb-hero" aria-labelledby="dpb-title">
          <h1 id="dpb-title" className="dpb-title dp-rise">
            <span>{first}</span>
            {second ? <span className="dpb-title-2">{second}</span> : null}
          </h1>
          <p className="dpb-lead dp-rise">{model.intro}</p>
          <div className="dpb-actions dp-rise">
            <Link className="dpb-btn dpb-btn-solid dpb-btn-lg" href={model.links.book}>
              {model.words.book}
            </Link>
            <Link className="dpb-btn dpb-btn-ghost dpb-btn-lg" href="#dich-vu">
              {model.words.viewServices}
            </Link>
          </div>
        </section>

        <section className="dpb-bento" aria-label={vi ? 'Thông tin nhanh' : 'At a glance'}>
          <PhotoSlot
            className="dpb-tile dpb-photo"
            image={model.heroImage}
            caption={
              vi
                ? 'Ảnh của tiệm: toàn cảnh phòng thư giãn'
                : 'The shop’s own photo: the relaxation room'
            }
          />
          {model.hours ? (
            <div className="dpb-tile dpb-hours">
              <span className="dpb-tile-label">
                <Icon name="clock" size={18} />
                {vi ? 'Giờ mở cửa' : 'Opening hours'}
              </span>
              <strong className="dpb-big">{model.hours.value}</strong>
              <span className="dpb-tile-sub">{model.hours.label}</span>
            </div>
          ) : null}
          {model.address ? (
            <div className="dpb-tile dpb-where">
              <span className="dpb-tile-label">
                <Icon name="map-pin" size={18} />
                {vi ? 'Địa chỉ' : 'Address'}
              </span>
              <strong className="dpb-mid">{model.address}</strong>
              {model.directions ? (
                <a
                  className="dpb-tile-link"
                  href={model.directions}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {vi ? 'Chỉ đường' : 'Directions'}
                </a>
              ) : null}
            </div>
          ) : null}
          <div className="dpb-tile dpb-book">
            <span className="dpb-tile-label">
              <Icon name="calendar-check" size={18} />
              {vi ? 'Đặt lịch trong một phút' : 'Book in a minute'}
            </span>
            <Link className="dpb-btn dpb-btn-light dpb-btn-lg" href={model.links.book}>
              {model.words.book}
            </Link>
            {model.hotline && model.tel ? (
              <a className="dpb-call" href={model.tel}>
                {model.words.hotline}: <strong>{model.hotline}</strong>
              </a>
            ) : null}
          </div>
        </section>

        <section className="dpb-section" id="dich-vu" aria-labelledby="dpb-services-title">
          <div className="dpb-section-head">
            <h2 id="dpb-services-title" className="dpb-h2">
              {model.words.groupsTitle}
            </h2>
            <p>{model.words.groupsLead}</p>
          </div>
          <div className="dpb-groups">
            {model.groups.map((group) => (
              <article className="dpb-group" key={group.code}>
                <header className="dpb-group-head">
                  <span className="dpb-group-icon" aria-hidden="true">
                    <Icon name={GROUP_ICON[group.code] ?? 'flower'} size={22} />
                  </span>
                  <div>
                    <h3>{group.name}</h3>
                    <p>
                      {group.count} {vi ? 'dịch vụ' : 'services'}
                      {group.from ? `, ${group.from}` : ''}
                    </p>
                  </div>
                </header>
                <ul className="dpb-list">
                  {group.services.slice(0, 4).map((service) => (
                    <li key={service.code}>
                      <Link href={service.href}>
                        <span>{service.name}</span>
                        <span className="dpb-price">{service.price}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="dpb-section" aria-labelledby="dpb-steps-title">
          <div className="dpb-section-head">
            <h2 id="dpb-steps-title" className="dpb-h2">
              {vi ? 'Đặt lịch trong ba bước' : 'Book in three steps'}
            </h2>
          </div>
          <ol className="dpb-steps">
            {(vi
              ? [
                  ['Chọn dịch vụ', 'Xem bảng giá rõ ràng, chọn một hoặc nhiều dịch vụ.'],
                  ['Chọn ngày giờ', 'Chọn ngày và một giờ còn trống.'],
                  ['Xác nhận', 'Lịch hẹn nằm trong tài khoản của bạn để xem lại bất cứ lúc nào.'],
                ]
              : [
                  ['Pick a service', 'Clear listed prices; choose one or more services.'],
                  ['Pick a time', 'Choose a day and a free time.'],
                  ['Confirm', 'The booking sits in your account to look at any time.'],
                ]
            ).map(([title, body], index) => (
              <li className="dpb-step" key={title}>
                <span className="dpb-step-no" aria-hidden="true">
                  {index + 1}
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {model.campaign ? (
          <section className="dpb-section" aria-label={model.campaign.name}>
            <div className="dpb-offer">
              {model.campaign.badge ? (
                <span className="dpb-chip">{model.campaign.badge}</span>
              ) : null}
              <h2 className="dpb-offer-title">{model.campaign.name}</h2>
              <p>{model.campaign.message}</p>
              <Link className="dpb-btn dpb-btn-solid dpb-btn-lg" href={model.campaign.href}>
                {model.campaign.cta}
              </Link>
            </div>
          </section>
        ) : null}
      </main>

      <footer className="dpb-footer">
        <p className="dpb-footer-logo">LUCY SPA</p>
        <p className="dpb-footer-line">
          {model.address ? <span>{model.address}</span> : null}
          {model.hotline ? <span>{model.hotline}</span> : null}
        </p>
      </footer>
    </div>
  );
}
