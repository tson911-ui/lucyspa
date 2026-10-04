import type { PublicFooterBlock } from '@lucy-spa/contracts';
import {
  FooterLinkList,
  FooterPicture,
  FooterText,
  SocialLinks,
  StoreBadges,
  type FooterBlockItem,
  type StoreBadgeItem,
} from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';

/**
 * The official store badges, as delivered by Google and Apple and never altered (public/badges). Google's file carries
 * transparent clear space around its artwork (the Vietnamese file 192 px of 250 px tall, the English one 168 px), so each
 * is drawn that many times taller than the badge height: both stores' artwork then share one height. The English file
 * also has 41 px of clear space on its left and right (the Vietnamese one has none); the footer pulls that margin back
 * so the badge sits at the column edge.
 */
const GOOGLE_PLAY = {
  vi: { src: '/badges/google-play-vi.png', width: 646, height: 250, fileScale: 250 / 192 },
  en: {
    src: '/badges/google-play-en.png',
    width: 646,
    height: 250,
    fileScale: 250 / 168,
    fileInset: 41 / 250,
  },
} as const;
const APP_STORE = {
  vi: { src: '/badges/app-store-vi.svg', width: 120, height: 40 },
  en: { src: '/badges/app-store-en.svg', width: 120, height: 40 },
} as const;

const isExternal = (url: string) => url.startsWith('https://');

/** The footer's blocks as the footer draws them, in the Owner's order (nothing at all when there are none). */
export function footerBlockItems(
  blocks: readonly PublicFooterBlock[],
  locale: Locale,
): FooterBlockItem[] {
  const text = getSiteText(locale).footer;
  const newTab = (name: string) => fill(text.newTab, { name });
  return blocks.map((block): FooterBlockItem => {
    switch (block.type) {
      case 'SOCIAL':
        return {
          key: block.id,
          node: (
            <SocialLinks
              label={text.social}
              items={block.links.map((link) => ({
                key: link.network,
                label: newTab(text.networks[link.network]),
                href: link.url,
                icon: link.network,
              }))}
            />
          ),
        };
      case 'APP': {
        const badges: StoreBadgeItem[] = [];
        if (block.googlePlayUrl !== null) {
          badges.push({
            key: 'google-play',
            label: newTab(text.googlePlay),
            href: block.googlePlayUrl,
            ...GOOGLE_PLAY[locale],
          });
        }
        if (block.appStoreUrl !== null) {
          badges.push({
            key: 'app-store',
            label: newTab(text.appStore),
            href: block.appStoreUrl,
            ...APP_STORE[locale],
          });
        }
        return { key: block.id, node: <StoreBadges items={badges} /> };
      }
      case 'TEXT':
      case 'SLOGAN':
        return { key: block.id, node: <FooterText>{block.text}</FooterText> };
      case 'LINKS':
        return {
          key: block.id,
          node: (
            <FooterLinkList
              title={block.title}
              items={block.items.map((item) =>
                isExternal(item.url) ? (
                  <a
                    key={item.url}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={newTab(item.label)}
                  >
                    {item.label}
                  </a>
                ) : (
                  <Link key={item.url} href={item.url}>
                    {item.label}
                  </Link>
                ),
              )}
            />
          ),
        };
      case 'IMAGE': {
        const widest = block.image.sources[block.image.sources.length - 1];
        const label =
          block.linkUrl !== null && isExternal(block.linkUrl)
            ? newTab(block.image.alt)
            : block.image.alt;
        return {
          key: block.id,
          node: (
            <FooterPicture href={block.linkUrl} label={label} LinkComponent={Link}>
              {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions */}
              <img
                src={widest?.url}
                srcSet={block.image.sources
                  .map((source) => `${source.url} ${source.width}w`)
                  .join(', ')}
                sizes="(min-width: 768px) 33vw, 100vw"
                width={block.image.width}
                height={block.image.height}
                alt={block.linkUrl === null ? block.image.alt : ''}
                loading="lazy"
                decoding="async"
              />
            </FooterPicture>
          ),
        };
      }
    }
  });
}
